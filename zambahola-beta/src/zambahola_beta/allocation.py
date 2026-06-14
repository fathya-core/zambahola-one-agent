"""Long-term trend / regime allocation — the realistic retail edge.

Short-horizon direction is efficient (see the rest of this package). Low-frequency
trend-following is different: it captures bull markets and steps aside in bears,
so it compounds better *through cycles* with far smaller drawdowns, and trades so
rarely that costs are negligible. This module backtests long/cash daily
strategies with textbook (un-tuned) parameters and compares them honestly to
buy-and-hold (HODL).

Signals are causal: the position for day t is decided from data up to day t-1
(shift(1)) and earns day t's return — no look-ahead.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# ---- signal builders (return a 0/1 long-or-cash position series, pre-shift) ----


def sma_trend(close: pd.Series, n: int) -> pd.Series:
    return (close > close.rolling(n).mean()).astype(float)


def momentum_trend(close: pd.Series, lookback: int) -> pd.Series:
    return (close.pct_change(lookback) > 0).astype(float)


def donchian_trend(close: pd.Series, n: int) -> pd.Series:
    """Long after a breakout above the prior n-day high; flat below prior n-low."""
    upper = close.shift(1).rolling(n).max()
    lower = close.shift(1).rolling(n).min()
    pos = pd.Series(np.nan, index=close.index)
    pos[close >= upper] = 1.0
    pos[close <= lower] = 0.0
    return pos.ffill().fillna(0.0)


def buy_hold(close: pd.Series) -> pd.Series:
    return pd.Series(1.0, index=close.index)


def default_strategies(close: pd.Series) -> dict[str, pd.Series]:
    """Textbook, un-tuned parameter set (no overfitting to this data)."""
    return {
        "HODL": buy_hold(close),
        "SMA50": sma_trend(close, 50),
        "SMA100": sma_trend(close, 100),
        "SMA200": sma_trend(close, 200),
        "MOM90": momentum_trend(close, 90),
        "Donchian55": donchian_trend(close, 55),
    }


# ---- backtest ----


def backtest_allocation(
    klines: pd.DataFrame,
    position: pd.Series,
    *,
    cost_bps: float = 10.0,
    periods_per_year: int = 365,
) -> dict:
    """Long/cash equity backtest. `position` in [0,1]; cost charged on turnover."""
    close = klines["close"].astype(float).reset_index(drop=True)
    pos = position.reset_index(drop=True).reindex(range(len(close))).fillna(0.0)
    ret = close.pct_change().fillna(0.0)

    # decide on yesterday's info, hold today (no look-ahead)
    held = pos.shift(1).fillna(0.0)
    turnover = held.diff().abs().fillna(held.abs())
    cost = turnover * (cost_bps / 1e4)
    strat_ret = held * ret - cost

    equity = (1.0 + strat_ret).cumprod()
    return _metrics(strat_ret, equity, held, periods_per_year)


def _metrics(strat_ret: pd.Series, equity: pd.Series, held: pd.Series, ppy: int) -> dict:
    n = len(strat_ret)
    years = n / ppy if ppy else 0.0
    total = float(equity.iloc[-1] - 1.0) if n else 0.0
    cagr = float(equity.iloc[-1] ** (1 / years) - 1.0) if years > 0 and equity.iloc[-1] > 0 else 0.0
    std = float(strat_ret.std(ddof=1)) if n > 1 else 0.0
    downside = strat_ret[strat_ret < 0]
    dstd = float(downside.std(ddof=1)) if len(downside) > 1 else 0.0
    sharpe = float(strat_ret.mean() / std * np.sqrt(ppy)) if std > 0 else float("nan")
    sortino = float(strat_ret.mean() / dstd * np.sqrt(ppy)) if dstd > 0 else float("nan")
    peak = equity.cummax()
    max_dd = float(((equity - peak) / peak).min()) if n else 0.0
    calmar = float(cagr / abs(max_dd)) if max_dd < 0 else float("nan")
    switches = int((held.diff().abs() > 0).sum())
    return {
        "total_return": round(total, 4),
        "cagr": round(cagr, 4),
        "sharpe": round(sharpe, 3),
        "sortino": round(sortino, 3),
        "max_drawdown": round(max_dd, 4),
        "calmar": round(calmar, 3) if calmar == calmar else None,
        "time_in_market": round(float(held.mean()), 3),
        "switches": switches,
        "final_equity": round(float(equity.iloc[-1]), 4) if n else 1.0,
    }


def compare_strategies(klines: pd.DataFrame, *, cost_bps: float = 10.0) -> pd.DataFrame:
    close = klines["close"].astype(float).reset_index(drop=True)
    rows = []
    for name, pos in default_strategies(close).items():
        m = backtest_allocation(klines, pos, cost_bps=cost_bps)
        rows.append({"strategy": name, **m})
    df = pd.DataFrame(rows)
    return df.sort_values("calmar", ascending=False, na_position="last").reset_index(drop=True)
