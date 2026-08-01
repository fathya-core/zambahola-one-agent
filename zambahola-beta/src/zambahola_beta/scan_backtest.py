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
from .universe import suggest_leverage


def backtest_scan(
    frames: dict[str, pd.DataFrame],
    *,
    top_n: int = 5,
    target_vol: float = 0.6,
    max_total: float = 1.0,
    min_consensus: float = 0.75,
    stop_pct: float = 0.25,
    max_weight: float = 1.0,
    require_mom30: bool = True,
    cost_bps: float = 10.0,
    leader: str = "BTCUSDT",
    warmup: int = 210,
    min_bars: int = 300,
    periods_per_year: float = 365.0,
    regime_floor: float = 0.4,
    conviction_power: float = 1.0,
    vol_power: float = 1.0,
    cap_vol_ref: float = 0.0,
    stop_cooldown_days: float = 0.0,
    end_index: int | None = None,
    start_index: int = 0,
    fng_df: "pd.DataFrame | None" = None,
    fng_greed_cut: float = 0.0,
    allow_short: bool = False,
    short_consensus: float = 0.25,
    starter_frac: float = 0.0,
    starter_max_vol: float = 1.5,
    starter_min_mom30: float = -0.10,
    starter_regime_min: float = 0.0,
    dd_penalty: float = 0.0,
    entry_max_dd: float = 0.12,
    max_spike_1d: float = 0.0,
    spike_base_max: float = 0.0,
    min_score_frac: float = 0.0,
    max_lev: float = 0.0,
    lev_target_vol: float = 0.9,
    lev_gross_cap: float = 3.0,
    funding_daily: float = 0.0003,
) -> dict:
    frames = {s: df for s, df in frames.items() if len(df) >= min_bars}
    if len(frames) < 2:
        return {"ok": False, "error": "need >=2 coins with enough history"}

    closes = align_closes(frames)
    names = [c for c in closes.columns if c != "open_time"]
    px = closes[names].astype(float)
    rets = px.pct_change()
    T = len(closes)
    last = min(end_index, T) if end_index is not None else T
    if last <= warmup + 5:
        return {"ok": False, "error": "not enough aligned history"}

    cons = {n: trend_consensus(px[n]) for n in names}
    mom90 = {n: px[n].pct_change(90) for n in names}
    mom30 = {n: px[n].pct_change(30) for n in names}
    vol = {n: realized_vol(px[n], 30) for n in names}
    dd = {n: px[n] / px[n].rolling(60).max() - 1.0 for n in names}
    # single-day pump detector: last-day return vs the 6-day base ending the day before
    ret1d = {n: px[n].pct_change(1) for n in names}
    base_prior = {n: px[n].shift(1) / px[n].shift(7) - 1.0 for n in names}
    roll_min = {n: px[n].rolling(60).min() for n in names} if allow_short else {}
    btc_cons = trend_consensus(px[leader]) if leader in names else None
    btc_mom90 = px[leader].pct_change(90) if leader in names else None

    # align Fear & Greed (sentiment) to the trading dates if provided
    fng_arr = None
    if fng_df is not None and fng_greed_cut > 0 and not fng_df.empty:
        m = pd.DataFrame({"date": pd.to_datetime(closes["open_time"], utc=True).dt.normalize()})
        fd = fng_df.copy()
        fd["date"] = pd.to_datetime(fd["date"], utc=True).dt.normalize()
        fng_arr = m.merge(fd, on="date", how="left")["fng"].ffill().to_numpy()

    port_ret: list[float] = []
    equity: list[float] = []
    eq = 1.0
    prev_wl: dict[str, float] = {n: 0.0 for n in names}  # previous NOTIONAL (w x lev)
    stop_until: dict[str, int] = {}  # anti-whipsaw: no re-entry until this bar index
    gross_sum = 0.0
    liq_events = 0  # coin-days where lev * ret <= -100% (isolated margin wiped)

    begin = max(warmup, start_index)  # start_index enables true out-of-sample windows
    for t in range(begin, last - 1):
        regime = 1.0
        if btc_cons is not None and not pd.isna(btc_cons.iloc[t]):
            regime = regime_floor + (1.0 - regime_floor) * float(btc_cons.iloc[t])
        eff_total = max_total * regime
        # sentiment overlay: trim exposure when the crowd is in extreme greed (froth)
        if fng_arr is not None:
            fv = fng_arr[t]
            if fv == fv and fv > 70:  # not NaN and greedy
                eff_total *= max(0.0, 1.0 - fng_greed_cut * (fv - 70) / 30.0)

        cand: list[tuple[str, float, float, bool]] = []
        for n in names:
            cn, m9, v = cons[n].iloc[t], mom90[n].iloc[t], vol[n].iloc[t]
            d, m3 = dd[n].iloc[t], mom30[n].iloc[t]
            if pd.isna(cn) or pd.isna(m9) or pd.isna(v):
                continue
            if d <= -stop_pct:
                # trailing stop hit -> mark a re-entry cooldown (anti-whipsaw)
                if stop_cooldown_days > 0:
                    stop_until[n] = t + int(stop_cooldown_days)
                continue
            if cn < min_consensus or m9 <= 0:
                continue
            if stop_cooldown_days > 0 and t < stop_until.get(n, -1):
                continue  # recently stopped out -> don't immediately rebuy into chop
            is_starter = False
            if require_mom30 and not pd.isna(m3) and m3 <= 0:
                # live gate: a coin rolling over short-term is normally refused. With
                # starter_frac>0 a CALM, trend-confirmed coin whose short momentum only
                # softened (not collapsed) may enter at a reduced "starter" weight so
                # idle cash is deployed into a confirmed uptrend instead of sitting out.
                if (starter_frac > 0 and m3 > starter_min_mom30
                        and v <= starter_max_vol and regime >= starter_regime_min):
                    is_starter = True
                else:
                    continue
            elif not pd.isna(d) and float(d) <= -abs(entry_max_dd):
                continue  # full pick but already rolled over from its high
            if not is_starter and max_spike_1d > 0:
                r1, bp = ret1d[n].iloc[t], base_prior[n].iloc[t]
                if (not pd.isna(r1) and not pd.isna(bp)
                        and r1 >= max_spike_1d and bp <= spike_base_max):
                    continue  # one-day pump on a dead base (DODO) — not a real trend
            ra = (m9 / v) if v > 0 else 0.0
            ac = (m3 - m9 / 3) if not pd.isna(m3) else 0.0
            rel = (m9 - btc_mom90.iloc[t]) if (btc_mom90 is not None and not pd.isna(btc_mom90.iloc[t])) else 0.0
            score = float(cn) * (max(0.0, ra) + 0.5 * max(0.0, ac) + 0.3 * max(0.0, rel) + 0.2 * max(0.0, m9))
            if dd_penalty > 0 and not pd.isna(d):
                # prefer clean trends near their highs over deep-pullback names
                score *= max(0.0, 1.0 + dd_penalty * float(d))
            if score > 0:
                cand.append((n, score, float(v), is_starter))

        # relative CONVICTION FLOOR: in a weak market only a couple coins score well;
        # funding marginal-score full picks (UNI 0.05, TRX 0.18 next to DEXE 3.83) just
        # bleeds -> drop full picks below min_score_frac * the best full score, holding
        # cash instead. Concentrates capital in real conviction. Starters are exempt.
        if min_score_frac > 0 and cand:
            full_scores = [c[1] for c in cand if not c[3]]
            if full_scores:
                floor = min_score_frac * max(full_scores)
                cand = [c for c in cand if c[3] or c[1] >= floor]

        # full picks first (by score), then starters — starters never displace a
        # coin that passes the strict gate
        cand.sort(key=lambda x: (x[3], -x[1]))
        picks = cand[:top_n]
        w = {n: 0.0 for n in names}
        if picks:
            raw = {}
            for n, score, v, st in picks:
                vs = min(1.0, (target_vol / v) ** vol_power) if v > 0 else 0.0
                mult = starter_frac if st else 1.0
                raw[n] = max(0.0, vs) * (max(0.1, score) ** conviction_power) * mult
            ssum = sum(raw.values()) or 1.0
            for n, rv in raw.items():
                w[n] = rv / ssum * eff_total
            if max_weight < 1.0:  # concentration cap (live): trimmed excess -> cash
                cap = max_weight * eff_total
                vmap = {n: v for n, _, v, _st in picks}
                for n in list(w):
                    c = cap
                    # vol-aware cap: a hyper-volatile coin gets a tighter ceiling so it
                    # can't dominate the book on score alone (cap_vol_ref=0 disables).
                    if cap_vol_ref > 0 and vmap.get(n, 0.0) > 0:
                        c = cap * min(1.0, cap_vol_ref / vmap[n])
                    if w[n] > c:
                        w[n] = c

        # SHORT book: short the strongest downtrends; budget grows as BTC weakens
        if allow_short:
            short_budget = max_total * max(0.0, 1.0 - regime)
            if short_budget > 0:
                scand = []
                for n in names:
                    cn, m9, v = cons[n].iloc[t], mom90[n].iloc[t], vol[n].iloc[t]
                    if pd.isna(cn) or pd.isna(m9) or pd.isna(v) or v < 0.10:
                        continue
                    if cn > short_consensus or m9 >= 0:
                        continue
                    rmin = roll_min[n].iloc[t]
                    dlow = (px[n].iloc[t] / rmin - 1.0) if rmin and rmin > 0 else 0.0
                    if dlow >= stop_pct:  # short stop: bounced too far off the low
                        continue
                    sscore = (1.0 - cn) * (max(0.0, -m9 / v if v > 0 else 0.0) + 0.2 * max(0.0, -m9))
                    if sscore > 0:
                        scand.append((n, sscore, v))
                scand.sort(key=lambda x: x[1], reverse=True)
                spicks = scand[:top_n]
                if spicks:
                    raw = {}
                    for n, score, v in spicks:
                        vs = min(1.0, target_vol / v) if v > 0 else 0.0
                        raw[n] = max(0.0, vs) * (max(0.1, score) ** conviction_power)
                    ssum = sum(raw.values()) or 1.0
                    for n, rv in raw.items():
                        w[n] = w.get(n, 0.0) - rv / ssum * short_budget  # negative = short

        # PER-COIN LEVERAGE (futures simulation) — the same advisor as the live scan:
        # vol budget x conviction x regime with a hard liquidation-safety cap; gross
        # notional (sum w*lev) capped at lev_gross_cap * regime. Extra notional pays
        # perpetual funding daily, and a coin-day where lev*ret <= -100% wipes that
        # position's margin (isolated liquidation) instead of going more negative.
        lev = {n: 1.0 for n in names}
        if max_lev > 1.0 and picks:
            best_sc = max(sc for _, sc, _, _ in picks)
            for n, sc, v, st in picks:
                if st:
                    continue  # starters are probes: never levered
                cn, d, r1 = cons[n].iloc[t], dd[n].iloc[t], ret1d[n].iloc[t]
                lev[n] = suggest_leverage(
                    float(v), float(sc), float(best_sc),
                    0.0 if pd.isna(cn) else float(cn), regime,
                    0.0 if pd.isna(d) else float(d),
                    0.0 if pd.isna(r1) else float(r1),
                    lev_target_vol=lev_target_vol, max_lev=max_lev,
                    periods_per_year=periods_per_year,
                )
            gross = sum(w[n] * lev[n] for n in names if w[n] > 0)
            cap_g = lev_gross_cap * regime
            if lev_gross_cap > 0 and gross > cap_g > 0:
                scale = cap_g / gross
                for n in lev:
                    lev[n] = max(1.0, round(lev[n] * scale, 1))

        wl = {n: w[n] * (lev[n] if w[n] > 0 else 1.0) for n in names}
        turnover = sum(abs(wl[n] - prev_wl[n]) for n in names)  # cost on real notional
        cost = turnover * cost_bps / 10000.0
        funding = sum(w[n] * (lev[n] - 1.0) for n in names if w[n] > 0) * funding_daily
        nxt = rets.iloc[t + 1]
        r = 0.0
        for n in names:
            wn = w[n]
            if wn == 0.0:
                continue
            rn_ = nxt[n]
            rn = 0.0 if pd.isna(rn_) else float(rn_)
            ln = lev[n] if wn > 0 else 1.0
            if ln > 1.0:
                lr = ln * rn
                if lr <= -1.0:
                    liq_events += 1
                r += wn * max(lr, -1.0)  # isolated: margin can't lose more than 100%
            else:
                r += wn * rn
        net = r - cost - funding
        gross_sum += sum(abs(x) for x in wl.values())
        eq *= (1 + net)
        port_ret.append(net)
        equity.append(eq)
        prev_wl = wl

    pr = np.array(port_ret)
    eqs = np.array(equity)
    days = len(pr)
    if days < 2:
        return {"ok": False, "error": "no backtest days"}
    peak = np.maximum.accumulate(eqs)
    mdd = float((eqs / peak - 1.0).min())
    cagr = float(eq ** (periods_per_year / days) - 1.0)
    sharpe = float(pr.mean() / pr.std() * np.sqrt(periods_per_year)) if pr.std() > 0 else 0.0
    btc_hodl = None
    if leader in names:
        btc_hodl = float(px[leader].iloc[last - 1] / px[leader].iloc[begin] - 1.0)

    return {
        "ok": True,
        "coins": len(names),
        "days": days,
        "start": str(closes["open_time"].iloc[begin]),
        "end": str(closes["open_time"].iloc[last - 1]),
        "total_return": round(float(eq - 1.0), 4),
        "cagr": round(cagr, 4),
        "sharpe": round(sharpe, 2),
        "max_drawdown": round(mdd, 4),
        "positive_days_pct": round(float((pr > 0).mean() * 100), 1),
        "btc_hodl_return": round(btc_hodl, 4) if btc_hodl is not None else None,
        "max_lev": max_lev,
        "avg_gross": round(gross_sum / days, 3),
        "liq_events": liq_events,
        "equity_curve": [round(float(x), 4) for x in eqs[::max(1, days // 80)]],
    }
