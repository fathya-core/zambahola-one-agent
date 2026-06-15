"""Causal walk-forward backtest of the ACTUAL agent strategy.

Unlike compare_portfolios (a 2-4 asset proxy), this simulates the real logic the
agent runs: market-wide smart-score ranking + market regime + trailing stop +
vol-targeted, conviction-tilted sizing, with turnover costs — so we get an honest
estimate of the strategy's return / drawdown vs simply holding BTC.

Diversification (correlation filter) is omitted here for tractability; it only
ever reduces concentration, so live results should be no worse on drawdown.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .strategy import align_closes, realized_vol, trend_consensus


def backtest_scan(
    frames: dict[str, pd.DataFrame],
    *,
    top_n: int = 5,
    target_vol: float = 0.6,
    max_total: float = 1.0,
    min_consensus: float = 0.75,
    stop_pct: float = 0.25,
    cost_bps: float = 10.0,
    leader: str = "BTCUSDT",
    warmup: int = 210,
    min_bars: int = 300,
) -> dict:
    frames = {s: df for s, df in frames.items() if len(df) >= min_bars}
    if len(frames) < 2:
        return {"ok": False, "error": "need >=2 coins with enough history"}

    closes = align_closes(frames)
    names = [c for c in closes.columns if c != "open_time"]
    px = closes[names].astype(float)
    rets = px.pct_change()
    T = len(closes)
    if T <= warmup + 5:
        return {"ok": False, "error": "not enough aligned history"}

    cons = {n: trend_consensus(px[n]) for n in names}
    mom90 = {n: px[n].pct_change(90) for n in names}
    mom30 = {n: px[n].pct_change(30) for n in names}
    vol = {n: realized_vol(px[n], 30) for n in names}
    dd = {n: px[n] / px[n].rolling(60).max() - 1.0 for n in names}
    btc_cons = trend_consensus(px[leader]) if leader in names else None
    btc_mom90 = px[leader].pct_change(90) if leader in names else None

    port_ret: list[float] = []
    equity: list[float] = []
    eq = 1.0
    prev_w: dict[str, float] = {n: 0.0 for n in names}

    for t in range(warmup, T - 1):
        regime = 1.0
        if btc_cons is not None and not pd.isna(btc_cons.iloc[t]):
            regime = 0.4 + 0.6 * float(btc_cons.iloc[t])
        eff_total = max_total * regime

        cand: list[tuple[str, float, float]] = []
        for n in names:
            cn, m9, v = cons[n].iloc[t], mom90[n].iloc[t], vol[n].iloc[t]
            d, m3 = dd[n].iloc[t], mom30[n].iloc[t]
            if pd.isna(cn) or pd.isna(m9) or pd.isna(v):
                continue
            if cn < min_consensus or m9 <= 0 or d <= -stop_pct:
                continue
            ra = (m9 / v) if v > 0 else 0.0
            ac = (m3 - m9 / 3) if not pd.isna(m3) else 0.0
            rel = (m9 - btc_mom90.iloc[t]) if (btc_mom90 is not None and not pd.isna(btc_mom90.iloc[t])) else 0.0
            score = float(cn) * (max(0.0, ra) + 0.5 * max(0.0, ac) + 0.3 * max(0.0, rel) + 0.2 * max(0.0, m9))
            if score > 0:
                cand.append((n, score, float(v)))

        cand.sort(key=lambda x: x[1], reverse=True)
        picks = cand[:top_n]
        w = {n: 0.0 for n in names}
        if picks:
            raw = {}
            for n, score, v in picks:
                vs = min(1.0, target_vol / v) if v > 0 else 0.0
                raw[n] = max(0.0, vs) * max(0.1, score)
            ssum = sum(raw.values()) or 1.0
            for n, rv in raw.items():
                w[n] = rv / ssum * eff_total

        turnover = sum(abs(w[n] - prev_w[n]) for n in names)
        cost = turnover * cost_bps / 10000.0
        nxt = rets.iloc[t + 1]
        r = sum(w[n] * (0.0 if pd.isna(nxt[n]) else nxt[n]) for n in names)
        net = r - cost
        eq *= (1 + net)
        port_ret.append(net)
        equity.append(eq)
        prev_w = w

    pr = np.array(port_ret)
    eqs = np.array(equity)
    days = len(pr)
    if days < 2:
        return {"ok": False, "error": "no backtest days"}
    peak = np.maximum.accumulate(eqs)
    mdd = float((eqs / peak - 1.0).min())
    cagr = float(eq ** (365.0 / days) - 1.0)
    sharpe = float(pr.mean() / pr.std() * np.sqrt(365)) if pr.std() > 0 else 0.0
    btc_hodl = None
    if leader in names:
        btc_hodl = float(px[leader].iloc[T - 1] / px[leader].iloc[warmup] - 1.0)

    return {
        "ok": True,
        "coins": len(names),
        "days": days,
        "start": str(closes["open_time"].iloc[warmup]),
        "end": str(closes["open_time"].iloc[T - 1]),
        "total_return": round(float(eq - 1.0), 4),
        "cagr": round(cagr, 4),
        "sharpe": round(sharpe, 2),
        "max_drawdown": round(mdd, 4),
        "positive_days_pct": round(float((pr > 0).mean() * 100), 1),
        "btc_hodl_return": round(btc_hodl, 4) if btc_hodl is not None else None,
        "equity_curve": [round(float(x), 4) for x in eqs[::max(1, days // 80)]],
    }
