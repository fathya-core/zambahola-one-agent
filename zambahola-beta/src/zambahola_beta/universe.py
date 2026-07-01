"""Market-wide trend scanner — widen the agent's horizon to ALL liquid coins.

Instead of a fixed BTC/ETH pair, fetch the most liquid USDT markets, score each
by trend strength, and rotate capital into the strongest uptrends. If the whole
market is down it correctly goes to cash; otherwise market breadth means there is
almost always something trending, so the agent stays active and "looks at the
whole market" like an expert.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import requests

from .data import fetch_klines
from .strategy import realized_vol, trend_consensus

TICKER_24H = "https://api.binance.com/api/v3/ticker/24hr"

# established coins with multi-year daily history (for a full-cycle backtest)
LONG_UNIVERSE = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "SOLUSDT",
    "LTCUSDT", "LINKUSDT", "DOTUSDT", "AVAXUSDT", "ATOMUSDT", "XLMUSDT", "TRXUSDT",
    "ETCUSDT", "BCHUSDT", "FILUSDT", "ALGOUSDT", "NEARUSDT", "EOSUSDT",
]

# leveraged tokens / stablecoins / wrapped — exclude from the tradable universe
_EXCLUDE_SUFFIX = ("UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT")
_STABLES = {
    "USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "BUSDUSDT", "DAIUSDT", "EURUSDT",
    "USDPUSDT", "USTUSDT", "PAXGUSDT", "WBTCUSDT", "USD1USDT", "USDEUSDT",
    "USDDUSDT", "GUSDUSDT", "FRAXUSDT", "LUSDUSDT", "USDJUSDT", "AEURUSDT",
    "EURIUSDT", "USDSUSDT", "XUSDUSDT", "RLUSDUSDT", "USDXUSDT", "BFUSDUSDT",
    "USDQUSDT", "EURQUSDT",
}


def fetch_top_symbols(
    n: int = 25,
    *,
    quote: str = "USDT",
    min_quote_volume: float = 50_000_000.0,
    session: requests.Session | None = None,
) -> list[str]:
    """Top `n` `quote` markets by 24h quote volume (excludes leveraged/stables).

    `min_quote_volume` is a hard LIQUIDITY FLOOR (24h quote volume in USDT): thin
    small-caps below it are dropped entirely. This matters because on testnet fills
    are frictionless, but in real trading a market order into a $2-10M/day coin
    slips badly — so we only ever trade genuinely liquid markets where testnet
    behaviour actually transfers to live. Symbols must also be pure-ASCII tickers
    (real Binance uses Latin symbols; anything else is filtered defensively).
    """
    sess = session or requests.Session()
    r = sess.get(TICKER_24H, timeout=20)
    r.raise_for_status()
    rows = r.json()
    cand = []
    for t in rows:
        sym = t.get("symbol", "")
        if not sym.endswith(quote) or not sym.isascii():
            continue
        if sym in _STABLES or any(sym.endswith(s) for s in _EXCLUDE_SUFFIX):
            continue
        try:
            vol = float(t.get("quoteVolume", 0.0))
        except (TypeError, ValueError):
            continue
        if vol < min_quote_volume:
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
    max_workers: int = 8,
    session: requests.Session | None = None,
) -> dict[str, pd.DataFrame]:
    """Resilient PARALLEL multi-symbol fetch: skip any symbol that errors/short.

    Each worker uses its own Session (requests Sessions are not thread-safe).
    Parallelism turns a ~20s sequential scan into a few seconds.
    """
    def _one(sym: str) -> tuple[str, pd.DataFrame | None]:
        try:
            df = fetch_klines(sym, interval, total, session=requests.Session())
        except Exception:  # noqa: BLE001
            return sym, None
        return sym, df if len(df) >= min_bars else None

    out: dict[str, pd.DataFrame] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        for sym, df in ex.map(_one, symbols):
            if df is not None:
                out[sym] = df
    return out


def trend_score(close: pd.Series, *, leader: pd.Series | None = None) -> dict:
    """Multi-factor trend strength for one coin (causal, last bar):

    - consensus: fraction of bullish trend votes (SMA50/100/200 + 90d).
    - mom90 / mom30: medium and short momentum.
    - vol: annualised realised vol (risk).
    - risk_adj: mom90 / vol (Sharpe-like — reward per unit of risk).
    - accel: mom30 - mom90/3 (is the move accelerating vs its own pace?).
    - rel_strength: 90d return minus the market leader's (BTC) — true alpha.
    """
    cons = float(trend_consensus(close).iloc[-1])
    mom90 = float(close.pct_change(90).iloc[-1]) if len(close) > 90 else 0.0
    mom30 = float(close.pct_change(30).iloc[-1]) if len(close) > 30 else 0.0
    rv = float(realized_vol(close, 30).iloc[-1]) if len(close) > 30 else 0.0
    risk_adj = (mom90 / rv) if rv > 0 else 0.0
    accel = mom30 - mom90 / 3.0
    rel = 0.0
    if leader is not None and len(leader) > 90:
        rel = mom90 - float(leader.pct_change(90).iloc[-1])
    # trailing drawdown: how far below the recent (60-bar) high we are now
    win = min(60, len(close))
    hi = float(close.rolling(win).max().iloc[-1]) if win > 0 else float(close.iloc[-1])
    dd_high = (float(close.iloc[-1]) / hi - 1.0) if hi > 0 else 0.0
    return {
        "consensus": cons,
        "momentum": round(mom90, 4),
        "mom30": round(mom30, 4),
        "vol": round(rv, 3),
        "risk_adj": round(risk_adj, 3),
        "accel": round(accel, 4),
        "rel_strength": round(rel, 4),
        "dd_high": round(dd_high, 4),
    }


def smart_score(s: dict) -> float:
    """Composite conviction for an uptrend: reward risk-adjusted momentum,
    acceleration, and relative strength vs the market — gated by trend
    consensus so we never chase a coin that isn't actually trending up."""
    if s["consensus"] < 0.5 or s["momentum"] <= 0:
        return 0.0
    return s["consensus"] * (
        max(0.0, s["risk_adj"])
        + 0.5 * max(0.0, s["accel"])
        + 0.3 * max(0.0, s["rel_strength"])
        + 0.2 * max(0.0, s["momentum"])
    )


def market_regime(frames: dict[str, pd.DataFrame], leader: str = "BTCUSDT") -> float:
    """Risk-on/off scale in [0.4, 1.0] from the market leader's trend.
    Alts crash with BTC, so when BTC is weak we cut total exposure (but never
    to zero — strong relative trends can still earn at reduced size)."""
    if leader not in frames:
        return 1.0
    close = frames[leader]["close"].astype(float).reset_index(drop=True)
    if len(close) < 200:
        return 1.0
    cons = float(trend_consensus(close).iloc[-1])
    return round(0.4 + 0.6 * cons, 3)


def scan(
    frames: dict[str, pd.DataFrame],
    *,
    top_n: int = 5,
    target_vol: float = 0.6,
    max_total: float = 1.0,
    min_consensus: float = 0.75,
    stop_pct: float = 0.35,
    conviction_power: float = 1.5,
    vol_power: float = 1.0,
    cap_vol_ref: float = 0.0,
    max_correlation: float = 0.85,
    corr_window: int = 60,
    min_vol: float = 0.10,
    max_weight: float = 1.0,
    held: set | None = None,
    hold_buffer: int = 2,
    leader: str = "BTCUSDT",
    use_regime: bool = True,
) -> dict:
    """Rank coins by a smart composite score, allocate to the strongest
    uptrends (vol-targeted, conviction-tilted), scaled by market regime, with a
    trailing stop that refuses coins that have fallen hard from their highs."""
    lead_close = None
    if leader in frames:
        lead_close = frames[leader]["close"].astype(float).reset_index(drop=True)

    scored = []
    for sym, df in frames.items():
        close = df["close"].astype(float).reset_index(drop=True)
        if len(close) < 120:
            continue
        s = trend_score(close, leader=lead_close)
        s["symbol"] = sym
        s["price"] = round(float(close.iloc[-1]), 6)
        s["score"] = round(smart_score(s), 4)
        s["stopped"] = s["dd_high"] <= -abs(stop_pct)
        scored.append(s)

    regime = market_regime(frames, leader) if use_regime else 1.0
    effective_total = max_total * regime

    # eligible = clear uptrend, positive conviction, not stopped out, AND real
    # volatility (min_vol auto-excludes stablecoins/pegged tokens — vol ~0).
    # mom30 > 0 also required: refuse a coin that's rolling over short-term even if
    # its medium trend is still up -> fewer marginal entries, auto-smaller book in
    # weak markets (we just hold more cash instead of forcing weak picks).
    eligible = [
        s for s in scored
        if s["consensus"] >= min_consensus and s["score"] > 0 and s["mom30"] > 0
        and not s["stopped"] and s["vol"] >= min_vol
    ]
    eligible.sort(key=lambda s: s["score"], reverse=True)

    # diversification: greedily take the highest scores, skipping any candidate
    # too correlated with one already picked (avoid a book that all crashes together)
    def _ret(sym: str) -> pd.Series:
        c = frames[sym]["close"].astype(float)
        return c.pct_change().tail(corr_window).reset_index(drop=True)

    held = set(held or [])
    # build a diversified shortlist a bit longer than top_n (grace zone for held)
    shortlist_n = top_n + (hold_buffer if held else 0)
    diversified: list[dict] = []
    for s in eligible:
        if len(diversified) >= shortlist_n:
            break
        if max_correlation < 1.0 and diversified:
            r = _ret(s["symbol"])
            too_corr = False
            for p in diversified:
                try:
                    c = r.corr(_ret(p["symbol"]))
                except Exception:  # noqa: BLE001
                    c = None
                if c is not None and c > max_correlation:
                    too_corr = True
                    break
            if too_corr:
                continue
        diversified.append(s)

    # hysteresis: keep coins we already hold while they stay in the shortlist
    # (don't churn on borderline rank flips); fill the rest with the best new trends
    kept = [s for s in diversified if s["symbol"] in held][:top_n]
    kept_syms = {s["symbol"] for s in kept}
    fill = [s for s in diversified if s["symbol"] not in kept_syms]
    picks = (kept + fill)[:top_n]
    picks.sort(key=lambda s: s["score"], reverse=True)

    targets: dict[str, float] = {}
    if picks:
        # weight = vol-target x conviction; normalise to the regime-scaled budget
        raw = {}
        for s in picks:
            # vol-target with an adjustable power: vol_power>1 penalises hyper-volatile
            # coins much harder, so a 400%-vol coin can't dominate the book on score alone.
            vscale = min(1.0, (target_vol / s["vol"]) ** vol_power) if s["vol"] > 0 else 0.0
            conviction = max(0.1, s["score"]) ** conviction_power
            raw[s["symbol"]] = max(0.0, vscale) * conviction
        ssum = sum(raw.values()) or 1.0
        for sym, w in raw.items():
            targets[sym] = round(w / ssum * effective_total, 4)
        # concentration cap: no single coin above max_weight of the book; the
        # trimmed excess simply stays in cash (safer than forcing it into a weaker coin)
        if max_weight < 1.0:
            cap = max_weight * effective_total
            vmap = {s["symbol"]: s["vol"] for s in picks}
            for sym in list(targets):
                c = cap
                # vol-aware cap: a hyper-volatile coin gets a tighter ceiling so it
                # can't dominate the book on score alone (cap_vol_ref=0 disables).
                if cap_vol_ref > 0 and vmap.get(sym, 0.0) > 0:
                    c = cap * min(1.0, cap_vol_ref / vmap[sym])
                if targets[sym] > c:
                    targets[sym] = round(c, 4)

    ranked = []
    for s in sorted(scored, key=lambda s: s["score"], reverse=True):
        if s["symbol"] in targets:
            action = "INVEST"
        elif s["consensus"] >= min_consensus and s["stopped"]:
            action = "STOP"  # would qualify, but trailing stop hit -> protect
        elif s["consensus"] >= min_consensus:
            action = "UPTREND"
        else:
            action = "CASH"
        ranked.append({
            "symbol": s["symbol"],
            "price": s["price"],
            "trend_consensus": round(s["consensus"], 2),
            "momentum": s["momentum"],
            "risk_adj": s["risk_adj"],
            "rel_strength": s["rel_strength"],
            "score": s["score"],
            "dd_high": s["dd_high"],
            "realized_vol_ann": s["vol"],
            "target_weight": targets.get(s["symbol"], 0.0),
            "action": action,
        })

    cash = round(max(0.0, 1.0 - sum(targets.values())), 4)
    return {
        "mode": "scan",
        "scanned": len(scored),
        "regime": regime,
        "picks": list(targets.keys()),
        "targets": targets,
        "cash_weight": cash,
        "ranked": ranked,
    }


def best_uptrends(ranked: list[dict], k: int = 8) -> list[dict]:
    return ranked[:k]
