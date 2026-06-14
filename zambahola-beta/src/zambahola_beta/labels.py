"""Labeling: volatility-scaled triple-barrier (López de Prado style).

For each bar t we look ahead `horizon` bars and place symmetric barriers at
+/- barrier_mult * vol_t * price_t. Whichever barrier the path touches first
sets the label; if neither is touched by the horizon it is a timeout (range).

Outputs both the categorical label and the realized forward return used by the
cost-aware backtest.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class LabelResult:
    label: pd.Series  # +1 up, -1 down, 0 timeout/range
    ret: pd.Series  # realized return from t to the touch/horizon bar
    touch: pd.Series  # 'up' | 'down' | 'timeout'


def rolling_vol(close: pd.Series, window: int) -> pd.Series:
    """Per-bar return volatility estimate (std of log returns)."""
    log_ret = np.log(close).diff()
    return log_ret.rolling(window).std(ddof=0)


def triple_barrier(
    klines: pd.DataFrame,
    horizon: int,
    vol_window: int,
    barrier_mult: float,
) -> LabelResult:
    df = klines.reset_index(drop=True)
    close = df["close"].astype(float).to_numpy()
    high = df["high"].astype(float).to_numpy()
    low = df["low"].astype(float).to_numpy()
    n = len(close)

    # Scale the per-bar volatility to the holding period (~vol * sqrt(horizon)),
    # so the target move represents the expected move over `horizon` bars rather
    # than a single bar. This keeps targets meaningful versus trading costs.
    vol = rolling_vol(df["close"].astype(float), vol_window).to_numpy() * np.sqrt(horizon)

    label = np.zeros(n, dtype=float)
    ret = np.full(n, np.nan, dtype=float)
    touch = np.array(["timeout"] * n, dtype=object)

    for t in range(n):
        v = vol[t]
        if not np.isfinite(v) or v <= 0 or t + horizon >= n:
            label[t] = np.nan
            touch[t] = "na"
            continue
        entry = close[t]
        band = barrier_mult * v * entry
        up_barrier = entry + band
        low_barrier = entry - band

        end = min(t + horizon, n - 1)
        hit = "timeout"
        exit_price = close[end]
        for j in range(t + 1, end + 1):
            if high[j] >= up_barrier:
                hit = "up"
                exit_price = up_barrier
                break
            if low[j] <= low_barrier:
                hit = "down"
                exit_price = low_barrier
                break
        label[t] = 1.0 if hit == "up" else -1.0 if hit == "down" else 0.0
        touch[t] = hit
        ret[t] = exit_price / entry - 1.0

    idx = df.index
    return LabelResult(
        label=pd.Series(label, index=idx, name="label"),
        ret=pd.Series(ret, index=idx, name="ret"),
        touch=pd.Series(touch, index=idx, name="touch"),
    )


def directional_dataset(labels: LabelResult) -> tuple[pd.Index, pd.Series]:
    """Bars with a clear up/down outcome and their binary target (1=up, 0=down)."""
    lab = labels.label
    directional = lab[(lab == 1.0) | (lab == -1.0)]
    y = (directional == 1.0).astype(int)
    return directional.index, y
