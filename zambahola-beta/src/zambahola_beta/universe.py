"""Market-wide trend scanner — widen the agent's horizon to ALL liquid coins.

Instead of a fixed BTC/ETH pair, fetch the most liquid USDT markets, score each
by trend strength, and rotate capital into the strongest uptrends. If the whole
market is down it correctly goes to cash; otherwise market breadth means there is
almost always something trending, so the agent stays active and "looks at the
whole market" like an expert.
"""

from __future__ import annotations

import pandas as pd
import requests

from .data import fetch_klines
from .strategy import realized_vol, trend_consensus

TICKER_24H = "https://api.binance.com/api/v3/ticker/24hr"

# leveraged tokens / stablecoins / wrapped — exclude from the tradable universe
_EXCLUDE_SUFFIX = ("UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT")
_STABLES = {
    "USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "BUSDUSDT", "DAIUSDT", "EURUSDT",
    "USDPUSDT", "USTUSDT", "PAXGUSDT", "WBTCUSDT", "USD1USDT", "USDEUSDT",
    "USDDUSDT", "GUSDUSDT", "FRAXUSDT", "LUSDUSDT", "USDJUSDT", "AEURUSDT",
    "EURIUSDT", "USDSUSDT", "XUSDUSDT",
}


def fetch_top_symbols(
    n: int = 25, *, quote: str = "USDT", session: requests.Session | None = None
) -> list[str]:
    """Top `n` `quote` markets by 24h quote volume (excludes leveraged/stables)."""
    sess = session or requests.Session()
    r = sess.get(TICKER_24H, timeout=20)
    r.raise_for_status()
    rows = r.json()
    cand = []
    for t in rows:
        sym = t.get("symbol", "")
        if not sym.endswith(quote):
            continue
        if sym in _STABLES or any(sym.endswith(s) for s in _EXCLUDE_SUFFIX):
            continue
        try:
            vol = float(t.get("quoteVolume", 0.0))
        except (TypeError, ValueError):
            continue
        cand.append((sym, vol))
    cand.sort(key=lambda x: x[1], reverse=True)
    return [s for s, _ in cand[:n]]


def fetch_frames(
    symbols: list[str],
    *,
    interval: str = "1d",
    total: int = 400,
    min_bars: int = 120,
    session: requests.Session | None = None,
) -> dict[str, pd.DataFrame]:
    """Resilient multi-symbol fetch: skip any symbol that errors or is too short."""
    sess = session or requests.Session()
    out: dict[str, pd.DataFrame] = {}
    for s in symbols:
        try:
            df = fetch_klines(s, interval, total, session=sess)
        except Exception:  # noqa: BLE001
            continue
        if len(df) >= min_bars:
            out[s] = df
    return out


def trend_score(close: pd.Series) -> dict:
    """Causal trend strength for one coin (consensus + 90d momentum + vol)."""
    cons = float(trend_consensus(close).iloc[-1])
    mom = float(close.pct_change(90).iloc[-1]) if len(close) > 90 else 0.0
    rv = float(realized_vol(close, 30).iloc[-1]) if len(close) > 30 else 0.0
    return {"consensus": cons, "momentum": round(mom, 4), "vol": round(rv, 3)}


def scan(
    frames: dict[str, pd.DataFrame],
    *,
    top_n: int = 5,
    target_vol: float = 0.6,
    max_total: float = 1.0,
    min_consensus: float = 0.75,
) -> dict:
    """Rank coins by trend, allocate to the top uptrends (vol-targeted)."""
    scored = []
    for sym, df in frames.items():
        close = df["close"].astype(float).reset_index(drop=True)
        if len(close) < 120:
            continue
        s = trend_score(close)
        s["symbol"] = sym
        s["price"] = round(float(close.iloc[-1]), 6)
        scored.append(s)

    # eligible = clear uptrend; rank the eligible by momentum
    eligible = [s for s in scored if s["consensus"] >= min_consensus and s["momentum"] > 0]
    eligible.sort(key=lambda s: s["momentum"], reverse=True)
    picks = eligible[:top_n]

    targets: dict[str, float] = {}
    if picks:
        # vol-target each pick, then normalise so the book sums to max_total
        raw = {}
        for s in picks:
            scale = min(1.0, target_vol / s["vol"]) if s["vol"] > 0 else 0.0
            raw[s["symbol"]] = max(0.0, scale)
        ssum = sum(raw.values()) or 1.0
        for sym, w in raw.items():
            targets[sym] = round(w / ssum * max_total, 4)

    ranked = []
    for s in sorted(scored, key=lambda s: s["momentum"], reverse=True):
        ranked.append({
            "symbol": s["symbol"],
            "price": s["price"],
            "trend_consensus": round(s["consensus"], 2),
            "momentum": s["momentum"],
            "realized_vol_ann": s["vol"],
            "target_weight": targets.get(s["symbol"], 0.0),
            "action": "INVEST" if s["symbol"] in targets else ("UPTREND" if s["consensus"] >= min_consensus else "CASH"),
        })

    cash = round(max(0.0, 1.0 - sum(targets.values())), 4)
    return {
        "mode": "scan",
        "scanned": len(scored),
        "picks": list(targets.keys()),
        "targets": targets,
        "cash_weight": cash,
        "ranked": ranked,
    }


def best_uptrends(ranked: list[dict], k: int = 8) -> list[dict]:
    return ranked[:k]
