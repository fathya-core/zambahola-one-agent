"""ZAMBAHOLA — the 'thinking' allocator (not a single-rule bot).

Upgrades simple SMA trend with three ideas that raise risk-adjusted return and
cut whipsaw, all causal and cost-aware:

1. Trend *consensus*: average several trend votes (SMA50/100/200 + 90d momentum)
   into a continuous exposure (0..1) instead of a binary flip -> fewer whipsaws,
   partial exposure when signals disagree.
2. Volatility targeting: scale exposure toward a target annualized vol -> lean in
   during calm uptrends, de-risk in turbulence -> better Sharpe/Calmar.
3. Multi-asset rotation: hold the strongest-trending asset (BTC/ETH/...) instead
   of one fixed coin -> capture whichever is leading.

All decisions use data up to day t-1 (positions are shifted before earning
returns), so there is no look-ahead.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

ANNUAL = 365


# ---------- building blocks ----------

def trend_consensus(close: pd.Series) -> pd.Series:
    """Continuous 0..1 exposure = fraction of trend votes that are bullish."""
    votes = [
        close > close.rolling(50).mean(),
        close > close.rolling(100).mean(),
        close > close.rolling(200).mean(),
        close.pct_change(90) > 0,
    ]
    score = sum(v.astype(float) for v in votes) / len(votes)
    return score


def realized_vol(close: pd.Series, lookback: int = 30) -> pd.Series:
    return close.pct_change().rolling(lookback).std(ddof=0) * np.sqrt(ANNUAL)


def vol_scale(close: pd.Series, target_vol: float, lookback: int, cap: float) -> pd.Series:
    rv = realized_vol(close, lookback)
    scale = (target_vol / rv).clip(upper=cap)
    return scale.fillna(0.0)


def asset_exposure(
    close: pd.Series, *, target_vol: float, vol_lookback: int, max_weight: float
) -> pd.Series:
    """Per-asset target weight (0..max_weight): consensus x vol-scale."""
    raw = trend_consensus(close) * vol_scale(close, target_vol, vol_lookback, cap=max_weight)
    return raw.clip(lower=0.0, upper=max_weight).fillna(0.0)


# ---------- weight builders (return a target-weight DataFrame, pre-shift) ----------

def align_closes(assets: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Inner-join all assets' close on open_time -> columns = asset names."""
    merged: pd.DataFrame | None = None
    for name, df in assets.items():
        sub = df[["open_time", "close"]].rename(columns={"close": name})
        merged = sub if merged is None else merged.merge(sub, on="open_time", how="inner")
    assert merged is not None
    return merged.sort_values("open_time").reset_index(drop=True)


def weights_ensemble(
    closes: pd.DataFrame, *, target_vol: float, vol_lookback: int, max_total: float
) -> pd.DataFrame:
    names = [c for c in closes.columns if c != "open_time"]
    exp = pd.DataFrame({n: asset_exposure(
        closes[n], target_vol=target_vol, vol_lookback=vol_lookback, max_weight=1.0
    ) for n in names})
    # split budget across assets, cap total exposure
    w = exp / len(names)
    total = w.sum(axis=1)
    over = total > max_total
    w.loc[over] = w.loc[over].mul(max_total / total[over], axis=0)
    return w.fillna(0.0)


def weights_rotation(
    closes: pd.DataFrame, *, target_vol: float, vol_lookback: int, max_total: float
) -> pd.DataFrame:
    """Hold the up-trending asset with the strongest 90d momentum (vol-scaled)."""
    names = [c for c in closes.columns if c != "open_time"]
    mom = pd.DataFrame({n: closes[n].pct_change(90) for n in names})
    uptrend = pd.DataFrame({n: closes[n] > closes[n].rolling(100).mean() for n in names})
    mom_masked = mom.where(uptrend, other=-np.inf)
    winner = mom_masked.idxmax(axis=1)
    any_up = uptrend.any(axis=1)

    w = pd.DataFrame(0.0, index=closes.index, columns=names)
    scales = {n: vol_scale(closes[n], target_vol, vol_lookback, cap=max_total) for n in names}
    for i in range(len(closes)):
        if not any_up.iloc[i]:
            continue
        win = winner.iloc[i]
        if isinstance(win, str):
            w.iat[i, names.index(win)] = float(min(max_total, scales[win].iloc[i]))
    return w.fillna(0.0)


# ---------- portfolio backtest ----------

def portfolio_backtest(closes: pd.DataFrame, weights: pd.DataFrame, *, cost_bps: float) -> dict:
    names = [c for c in closes.columns if c != "open_time"]
    rets = closes[names].pct_change().fillna(0.0)
    held = weights[names].shift(1).fillna(0.0)
    turnover = held.diff().abs().sum(axis=1).fillna(held.abs().sum(axis=1))
    port_ret = (held * rets).sum(axis=1) - turnover * (cost_bps / 1e4)
    equity = (1.0 + port_ret).cumprod()
    return _metrics(port_ret, equity, held.sum(axis=1))


def _metrics(port_ret: pd.Series, equity: pd.Series, gross_exposure: pd.Series) -> dict:
    n = len(port_ret)
    years = n / ANNUAL if n else 0.0
    final = float(equity.iloc[-1]) if n else 1.0
    cagr = float(final ** (1 / years) - 1.0) if years > 0 and final > 0 else 0.0
    std = float(port_ret.std(ddof=1)) if n > 1 else 0.0
    downside = port_ret[port_ret < 0]
    dstd = float(downside.std(ddof=1)) if len(downside) > 1 else 0.0
    sharpe = float(port_ret.mean() / std * np.sqrt(ANNUAL)) if std > 0 else float("nan")
    sortino = float(port_ret.mean() / dstd * np.sqrt(ANNUAL)) if dstd > 0 else float("nan")
    peak = equity.cummax()
    max_dd = float(((equity - peak) / peak).min()) if n else 0.0
    calmar = float(cagr / abs(max_dd)) if max_dd < 0 else float("nan")
    return {
        "total_return": round(final - 1.0, 4),
        "cagr": round(cagr, 4),
        "sharpe": round(sharpe, 3),
        "sortino": round(sortino, 3),
        "max_drawdown": round(max_dd, 4),
        "calmar": round(calmar, 3) if calmar == calmar else None,
        "avg_exposure": round(float(gross_exposure.mean()), 3),
        "final_equity": round(final, 4),
    }


def compare_portfolios(
    assets: dict[str, pd.DataFrame],
    *,
    cost_bps: float = 10.0,
    target_vol: float = 0.6,
    vol_lookback: int = 30,
    max_total: float = 1.0,
) -> pd.DataFrame:
    """Benchmark the thinking allocator vs SMA100 and HODL on the same data."""
    from .allocation import sma_trend

    closes = align_closes(assets)
    names = [c for c in closes.columns if c != "open_time"]
    first = names[0]

    rows = []
    # baselines on the first asset
    hodl = pd.DataFrame({first: pd.Series(1.0, index=closes.index)})
    rows.append({"strategy": f"HODL_{first}", **portfolio_backtest(closes, _pad(hodl, names), cost_bps=cost_bps)})
    sma = pd.DataFrame({first: sma_trend(closes[first], 100)})
    rows.append({"strategy": f"SMA100_{first}", **portfolio_backtest(closes, _pad(sma, names), cost_bps=cost_bps)})

    w_ens = weights_ensemble(closes, target_vol=target_vol, vol_lookback=vol_lookback, max_total=max_total)
    rows.append({"strategy": "Ensemble+VolTgt", **portfolio_backtest(closes, w_ens, cost_bps=cost_bps)})

    w_rot = weights_rotation(closes, target_vol=target_vol, vol_lookback=vol_lookback, max_total=max_total)
    rows.append({"strategy": "Rotation+VolTgt", **portfolio_backtest(closes, w_rot, cost_bps=cost_bps)})

    return pd.DataFrame(rows).sort_values("calmar", ascending=False, na_position="last").reset_index(drop=True)


def _pad(w: pd.DataFrame, names: list[str]) -> pd.DataFrame:
    for n in names:
        if n not in w.columns:
            w[n] = 0.0
    return w


def current_allocation(
    assets: dict[str, pd.DataFrame],
    *,
    mode: str = "ensemble",
    target_vol: float = 0.6,
    vol_lookback: int = 30,
    max_total: float = 1.0,
) -> dict:
    """Today's target allocation + transparent reasoning (for the live advisor)."""
    closes = align_closes(assets)
    names = [c for c in closes.columns if c != "open_time"]
    if mode == "rotation":
        w = weights_rotation(closes, target_vol=target_vol, vol_lookback=vol_lookback, max_total=max_total)
    else:
        w = weights_ensemble(closes, target_vol=target_vol, vol_lookback=vol_lookback, max_total=max_total)

    last = w.iloc[-1]
    targets = {n: round(float(last[n]), 3) for n in names}
    reasons = {}
    for n in names:
        cons = float(trend_consensus(closes[n]).iloc[-1])
        rv = float(realized_vol(closes[n], vol_lookback).iloc[-1])
        reasons[n] = {
            "price": round(float(closes[n].iloc[-1]), 2),
            "trend_consensus": round(cons, 2),
            "realized_vol_ann": round(rv, 3),
            "target_weight": targets[n],
            "action": _action(targets[n]),
        }
    return {
        "mode": mode,
        "as_of": str(closes["open_time"].iloc[-1]),
        "cash_weight": round(float(max(0.0, 1.0 - sum(targets.values()))), 3),
        "targets": targets,
        "reasons": reasons,
    }


def _action(weight: float) -> str:
    if weight <= 0.05:
        return "CASH — stay out"
    if weight >= 0.66:
        return "INVEST — strong"
    return "PARTIAL — scale in"

