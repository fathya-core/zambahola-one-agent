"""Live L2 microstructure recorder (Binance partial book + aggregated trades).

Streams `btcusdt@depth20@100ms` (full top-20 book every 100ms — no diff
reconstruction needed) and `btcusdt@aggTrade`, aggregates them into fixed-time
bars, and records order-flow features (Cont order-flow imbalance, multi-level
book imbalance, signed trade flow) plus the mid-price OHLC so the existing
triple-barrier labeler works unchanged. Rows are written to parquet.

Pure helpers (parse_message, book_features, cont_ofi, MicroBarBuilder) are fully
unit-tested offline; only `record()` touches the network.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

WS_URL = (
    "wss://stream.binance.com:9443/stream"
    "?streams={sym}@depth20@100ms/{sym}@aggTrade"
)

MICRO_COLUMNS = [
    "ts", "open", "high", "low", "close", "microprice", "spread_bps",
    "imb1", "imb5", "imb20", "bid_depth", "ask_depth",
    "ofi", "n_book", "trade_signed_vol", "trade_vol", "trade_count", "trade_vwap",
]


def parse_message(msg: dict) -> tuple | None:
    """Return ('depth', bids, asks) | ('trade', price, qty, is_buyer_maker) | None."""
    stream = msg.get("stream", "")
    data = msg.get("data", msg)
    if "depth" in stream or ("bids" in data and "asks" in data):
        bids = [(float(p), float(q)) for p, q in data.get("bids", [])]
        asks = [(float(p), float(q)) for p, q in data.get("asks", [])]
        if not bids or not asks:
            return None
        return ("depth", bids, asks)
    if "aggTrade" in stream or data.get("e") == "aggTrade":
        return ("trade", float(data["p"]), float(data["q"]), bool(data["m"]))
    return None


def _imbalance(bids: list[tuple[float, float]], asks: list[tuple[float, float]], n: int) -> float:
    b = sum(q for _, q in bids[:n])
    a = sum(q for _, q in asks[:n])
    total = b + a
    return (b - a) / total if total > 0 else 0.0


def book_features(bids: list[tuple[float, float]], asks: list[tuple[float, float]]) -> dict:
    best_bid, bid_sz = bids[0]
    best_ask, ask_sz = asks[0]
    mid = (best_bid + best_ask) / 2.0
    denom = bid_sz + ask_sz
    microprice = (best_bid * ask_sz + best_ask * bid_sz) / denom if denom > 0 else mid
    spread_bps = (best_ask - best_bid) / mid * 1e4 if mid > 0 else 0.0
    return {
        "best_bid": best_bid, "bid_sz": bid_sz,
        "best_ask": best_ask, "ask_sz": ask_sz,
        "mid": mid, "microprice": microprice, "spread_bps": spread_bps,
        "imb1": _imbalance(bids, asks, 1),
        "imb5": _imbalance(bids, asks, 5),
        "imb20": _imbalance(bids, asks, 20),
        "bid_depth": sum(q for _, q in bids[:20]),
        "ask_depth": sum(q for _, q in asks[:20]),
    }


def cont_ofi(prev: dict, cur: dict) -> float:
    """Cont et al. best-level order-flow imbalance between two book snapshots."""
    pb, pbs, pa, pas = prev["best_bid"], prev["bid_sz"], prev["best_ask"], prev["ask_sz"]
    bb, bbs, ba, bas = cur["best_bid"], cur["bid_sz"], cur["best_ask"], cur["ask_sz"]
    if bb > pb:
        e_bid = bbs
    elif bb == pb:
        e_bid = bbs - pbs
    else:
        e_bid = -pbs
    if ba > pa:
        e_ask = -pas
    elif ba == pa:
        e_ask = bas - pas
    else:
        e_ask = bas
    return e_bid - e_ask


@dataclass
class MicroBarBuilder:
    """Aggregates depth/trade events into fixed-time mid-price OHLC bars."""

    bar_ms: int = 1000
    _bar_start: int | None = None
    _last_book: dict | None = None
    _open: float | None = None
    _high: float = field(default=float("-inf"))
    _low: float = field(default=float("inf"))
    _close: float = 0.0
    _last_micro: float = 0.0
    _last_spread: float = 0.0
    _imb1: float = 0.0
    _imb5: float = 0.0
    _imb20: float = 0.0
    _bid_depth: float = 0.0
    _ask_depth: float = 0.0
    _ofi: float = 0.0
    _n_book: int = 0
    _t_signed: float = 0.0
    _t_vol: float = 0.0
    _t_count: int = 0
    _t_pv: float = 0.0  # price*qty for vwap

    def _bar_of(self, ts: int) -> int:
        return (ts // self.bar_ms) * self.bar_ms

    def add_book(self, ts: int, bids, asks) -> dict | None:
        row = self._maybe_roll(ts)
        bf = book_features(bids, asks)
        if self._last_book is not None:
            self._ofi += cont_ofi(self._last_book, bf)
        self._last_book = bf
        self._n_book += 1
        mid = bf["mid"]
        if self._open is None:
            self._open = mid
        self._high = max(self._high, mid)
        self._low = min(self._low, mid)
        self._close = mid
        self._last_micro = bf["microprice"]
        self._last_spread = bf["spread_bps"]
        self._imb1, self._imb5, self._imb20 = bf["imb1"], bf["imb5"], bf["imb20"]
        self._bid_depth, self._ask_depth = bf["bid_depth"], bf["ask_depth"]
        return row

    def add_trade(self, ts: int, price: float, qty: float, is_buyer_maker: bool) -> dict | None:
        row = self._maybe_roll(ts)
        # buyer is maker -> aggressor is the seller -> sell flow (negative)
        signed = -qty if is_buyer_maker else qty
        self._t_signed += signed
        self._t_vol += qty
        self._t_count += 1
        self._t_pv += price * qty
        return row

    def _maybe_roll(self, ts: int) -> dict | None:
        bar = self._bar_of(ts)
        if self._bar_start is None:
            self._bar_start = bar
            return None
        if bar > self._bar_start:
            row = self._emit()
            self._bar_start = bar
            self._reset_bar()
            return row
        return None

    def _emit(self) -> dict | None:
        if self._open is None or self._n_book == 0:
            return None
        vwap = self._t_pv / self._t_vol if self._t_vol > 0 else self._close
        return {
            "ts": self._bar_start,
            "open": self._open, "high": self._high, "low": self._low, "close": self._close,
            "microprice": self._last_micro, "spread_bps": self._last_spread,
            "imb1": self._imb1, "imb5": self._imb5, "imb20": self._imb20,
            "bid_depth": self._bid_depth, "ask_depth": self._ask_depth,
            "ofi": self._ofi, "n_book": self._n_book,
            "trade_signed_vol": self._t_signed, "trade_vol": self._t_vol,
            "trade_count": self._t_count, "trade_vwap": vwap,
        }

    def _reset_bar(self) -> None:
        self._open = None
        self._high = float("-inf")
        self._low = float("inf")
        self._ofi = 0.0
        self._n_book = 0
        self._t_signed = 0.0
        self._t_vol = 0.0
        self._t_count = 0
        self._t_pv = 0.0

    def finalize(self) -> dict | None:
        return self._emit()


def synthetic_micro(n: int = 6000, *, seed: int = 9, start: float = 50_000.0):
    """Deterministic micro bars where OFI/imbalance weakly lead the next return.

    Used for offline tests of the micro pipeline (a learnable signal so model
    tests can assert AUC > 0.5 without the network).
    """
    import numpy as np

    rng = np.random.default_rng(seed)
    ofi = rng.normal(0, 50, n)
    imb = np.tanh(ofi / 80.0) + rng.normal(0, 0.1, n)
    # next log-return leans with current (lagged) order-flow signal
    signal = 0.00002 * ofi + 0.0003 * imb
    log_ret = np.concatenate([[0.0], signal[:-1]]) + rng.normal(0, 0.0004, n)
    close = start * np.exp(np.cumsum(log_ret))
    open_ = np.concatenate([[start], close[:-1]])
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.0002, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.0002, n)))
    spread = np.abs(rng.normal(1.0, 0.2, n))
    bid_depth = rng.lognormal(3.0, 0.3, n)
    ask_depth = rng.lognormal(3.0, 0.3, n)
    t_vol = rng.lognormal(1.0, 0.5, n)
    t_signed = np.sign(imb) * t_vol * rng.uniform(0.2, 0.8, n)
    ts = (np.arange(n) * 1000 + 1_700_000_000_000).astype("int64")

    return pd.DataFrame(
        {
            "ts": ts,
            "open": open_, "high": high, "low": low, "close": close,
            "microprice": close * (1 + imb * 1e-5),
            "spread_bps": spread,
            "imb1": np.clip(imb, -1, 1),
            "imb5": np.clip(imb * 0.9, -1, 1),
            "imb20": np.clip(imb * 0.8, -1, 1),
            "bid_depth": bid_depth, "ask_depth": ask_depth,
            "ofi": ofi, "n_book": rng.integers(3, 12, n).astype(float),
            "trade_signed_vol": t_signed, "trade_vol": t_vol,
            "trade_count": rng.integers(1, 20, n).astype(float),
            "trade_vwap": close,
        },
        columns=MICRO_COLUMNS,
    )


def micro_dir(data_dir: Path) -> Path:
    return data_dir / "micro"


def save_micro(rows: list[dict], data_dir: Path, symbol: str) -> Path:
    out = micro_dir(data_dir)
    out.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows, columns=MICRO_COLUMNS)
    path = out / f"micro_{symbol}_{int(time.time())}.parquet"
    df.to_parquet(path, index=False)
    return path


def load_micro(data_dir: Path) -> pd.DataFrame:
    out = micro_dir(data_dir)
    files = sorted(out.glob("micro_*.parquet")) if out.exists() else []
    if not files:
        raise FileNotFoundError(f"no micro parquet files in {out}")
    frames = [pd.read_parquet(f) for f in files]
    df = pd.concat(frames, ignore_index=True)
    df = df.drop_duplicates(subset="ts").sort_values("ts").reset_index(drop=True)
    return df


async def record(
    *,
    symbol: str = "BTCUSDT",
    duration_sec: float = 60.0,
    bar_ms: int = 1000,
    data_dir: Path,
    flush_every: int = 300,
    verbose: bool = True,
) -> Path:
    """Connect to Binance WS and record micro bars to parquet for `duration_sec`."""
    import websockets

    url = WS_URL.format(sym=symbol.lower())
    builder = MicroBarBuilder(bar_ms=bar_ms)
    rows: list[dict] = []
    deadline = time.time() + duration_sec

    async with websockets.connect(url, open_timeout=15, ping_interval=20) as ws:
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=10)
            except asyncio.TimeoutError:
                continue
            parsed = parse_message(json.loads(raw))
            if parsed is None:
                continue
            ts = int(time.time() * 1000)
            if parsed[0] == "depth":
                row = builder.add_book(ts, parsed[1], parsed[2])
            else:
                row = builder.add_trade(ts, parsed[1], parsed[2], parsed[3])
            if row:
                rows.append(row)
                if verbose and len(rows) % 10 == 0:
                    print(f"[record] bars={len(rows)} last_mid={row['close']:.2f} ofi={row['ofi']:.2f}")

    final = builder.finalize()
    if final:
        rows.append(final)
    path = save_micro(rows, data_dir, symbol)
    if verbose:
        print(f"[record] saved {len(rows)} bars -> {path}")
    return path
