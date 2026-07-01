"""Data ingestion: Binance public klines -> tidy DataFrame -> parquet.

No API keys required (public REST). Includes a deterministic synthetic
generator so the whole pipeline + tests run fully offline.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

BINANCE_KLINES = "https://api.binance.com/api/v3/klines"
# failover order for public market data: primary, then Binance's official public
# data mirror (keeps the scanner alive if the primary host is down/geo-blocked).
KLINE_HOSTS = (
    "https://api.binance.com",
    "https://data-api.binance.vision",
    "https://api-gcp.binance.com",
)

# interval string -> milliseconds (for dropping the still-forming last candle)
_INTERVAL_MS = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
    "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
    "1w": 604_800_000,
}

# Raw kline columns returned by Binance, in order.
_RAW_COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
]

# Columns we keep/produce (taker_buy_base carries order-flow information).
COLUMNS = [
    "open_time", "open", "high", "low", "close", "volume",
    "quote_volume", "trades", "taker_buy_base",
]


def _to_frame(rows: list[list]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=_RAW_COLS)
    numeric = ["open", "high", "low", "close", "volume", "quote_volume",
               "trades", "taker_buy_base", "taker_buy_quote"]
    for c in numeric:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["open_time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    return df[COLUMNS].copy()


def fetch_klines(
    symbol: str = "BTCUSDT",
    interval: str = "1m",
    total: int = 30_000,
    *,
    session: requests.Session | None = None,
    sleep_sec: float = 0.25,
    drop_unclosed: bool = True,
) -> pd.DataFrame:
    """Fetch `total` most-recent klines by paging backward (<=1000/request).

    `drop_unclosed=True` removes the still-forming latest candle so signals are
    computed on CLOSED bars only. Using a live/partial bar's moving close is a
    subtle look-ahead: the value that triggered a decision keeps changing until
    the bar closes, causing intraday flip-flops that never appear in a backtest.
    """
    sess = session or requests.Session()
    limit = 1000
    end_time: int | None = None
    chunks: list[pd.DataFrame] = []
    remaining = total

    while remaining > 0:
        params = {"symbol": symbol, "interval": interval, "limit": min(limit, remaining)}
        if end_time is not None:
            params["endTime"] = end_time
        rows = None
        last_exc: Exception | None = None
        for host in KLINE_HOSTS:  # failover across public data hosts
            try:
                resp = sess.get(f"{host}/api/v3/klines", params=params, timeout=15)
                resp.raise_for_status()
                rows = resp.json()
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                continue
        if rows is None:
            if chunks:  # keep what we already have rather than lose the whole fetch
                break
            raise RuntimeError(f"Binance klines failed on all hosts: {last_exc}")
        if not rows:
            break
        frame = _to_frame(rows)
        chunks.append(frame)
        remaining -= len(frame)
        # next page ends just before the oldest bar we just received
        oldest_ms = int(rows[0][0])
        end_time = oldest_ms - 1
        if len(rows) < params["limit"]:
            break
        time.sleep(sleep_sec)

    if not chunks:
        raise RuntimeError("Binance returned no klines")

    df = pd.concat(chunks, ignore_index=True)
    df = df.drop_duplicates(subset="open_time").sort_values("open_time")
    df = df.reset_index(drop=True)
    # drop the still-forming last candle (its bar-close is in the future)
    if drop_unclosed and len(df) > 1:
        step_ms = _INTERVAL_MS.get(interval)
        if step_ms:
            now_ms = int(time.time() * 1000)
            last_open_ms = int(df["open_time"].iloc[-1].value // 1_000_000)
            if last_open_ms + step_ms > now_ms:  # bar hasn't closed yet
                df = df.iloc[:-1].reset_index(drop=True)
    return df.tail(total).reset_index(drop=True)


def fetch_many(
    symbols: list[str],
    interval: str = "5m",
    total: int = 30_000,
    *,
    session: requests.Session | None = None,
) -> dict[str, pd.DataFrame]:
    """Fetch klines for several symbols (for cross-asset analysis)."""
    sess = session or requests.Session()
    return {s: fetch_klines(s, interval, total, session=sess) for s in symbols}


def save_klines(df: pd.DataFrame, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    return path


def load_klines(path: Path) -> pd.DataFrame:
    df = pd.read_parquet(path)
    if "open_time" in df.columns:
        df["open_time"] = pd.to_datetime(df["open_time"], utc=True)
    return df


def synthetic_klines(
    n: int = 5_000,
    *,
    seed: int = 7,
    start_price: float = 50_000.0,
    interval_minutes: int = 1,
) -> pd.DataFrame:
    """Deterministic OHLCV with mild regime/momentum structure for tests.

    A small autocorrelated drift makes direction *slightly* learnable, so model
    tests can assert AUC > 0.5 without depending on the network.
    """
    rng = np.random.default_rng(seed)
    # autocorrelated drift (AR(1)) + noise -> log returns
    drift = np.zeros(n)
    for i in range(1, n):
        drift[i] = 0.6 * drift[i - 1] + rng.normal(0, 0.0004)
    noise = rng.normal(0, 0.0010, n)
    log_ret = drift + noise
    close = start_price * np.exp(np.cumsum(log_ret))

    high = close * (1 + np.abs(rng.normal(0, 0.0006, n)))
    low = close * (1 - np.abs(rng.normal(0, 0.0006, n)))
    open_ = np.empty(n)
    open_[0] = start_price
    open_[1:] = close[:-1]
    high = np.maximum.reduce([high, open_, close])
    low = np.minimum.reduce([low, open_, close])

    volume = rng.lognormal(mean=2.0, sigma=0.5, size=n)
    # taker-buy share leans with the drift sign (order-flow proxy)
    buy_share = np.clip(0.5 + 8.0 * drift + rng.normal(0, 0.05, n), 0.05, 0.95)
    taker_buy_base = volume * buy_share
    trades = rng.integers(50, 500, n).astype(float)

    start = pd.Timestamp("2025-01-01", tz="UTC")
    open_time = start + pd.to_timedelta(np.arange(n) * interval_minutes, unit="m")

    return pd.DataFrame(
        {
            "open_time": open_time,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
            "quote_volume": volume * close,
            "trades": trades,
            "taker_buy_base": taker_buy_base,
        }
    )
