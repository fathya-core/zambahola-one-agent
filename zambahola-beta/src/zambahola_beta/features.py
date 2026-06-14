"""Feature engineering.

All features use only information available at or before bar t (no look-ahead).
Mixes classic price features with order-flow / microstructure proxies derived
from Binance's taker-buy volume and trade counts — research shows order-flow
carries most of the short-horizon predictive power.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

FEATURE_COLUMNS = [
    "ret_1", "ret_5", "ret_15", "ret_30", "ret_60",
    "vol_short", "vol_long", "vol_ratio", "vol_of_vol",
    "rsi", "macd_hist", "bb_pct", "zscore", "momentum", "mom_accel",
    "range_pct", "body_pct",
    "dist_hi", "dist_lo",
    "volume_z", "trades_z",
    "taker_buy_ratio", "taker_buy_dev", "taker_buy_mom",
    "time_sin", "time_cos",
]


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100 - 100 / (1 + rs)
    return rsi.fillna(50.0)


def _ema(s: pd.Series, span: int) -> pd.Series:
    return s.ewm(span=span, adjust=False).mean()


def _zscore(s: pd.Series, window: int) -> pd.Series:
    mean = s.rolling(window).mean()
    std = s.rolling(window).std(ddof=0)
    z = (s - mean) / std.replace(0.0, np.nan)
    # A flat (zero-variance) full window has z-score 0 by definition; only the
    # warmup window (mean still NaN) should remain NaN. Prevents an entire
    # feature column going NaN when a series is locally constant.
    flat = mean.notna() & (std == 0.0)
    return z.mask(flat, 0.0)


def build_features(klines: pd.DataFrame) -> pd.DataFrame:
    """Return a feature DataFrame aligned to `klines` (warmup rows dropped)."""
    df = klines.reset_index(drop=True).copy()
    close = df["close"].astype(float)
    high = df["high"].astype(float)
    low = df["low"].astype(float)
    open_ = df["open"].astype(float)
    volume = df["volume"].astype(float).replace(0.0, np.nan)

    log_ret = np.log(close).diff()

    feat = pd.DataFrame(index=df.index)
    feat["ret_1"] = log_ret
    feat["ret_5"] = np.log(close).diff(5)
    feat["ret_15"] = np.log(close).diff(15)
    feat["ret_30"] = np.log(close).diff(30)
    feat["ret_60"] = np.log(close).diff(60)

    vol_short = log_ret.rolling(10).std(ddof=0)
    vol_long = log_ret.rolling(60).std(ddof=0)
    feat["vol_short"] = vol_short
    feat["vol_long"] = vol_long
    feat["vol_ratio"] = vol_short / vol_long.replace(0.0, np.nan) - 1.0
    # volatility-of-volatility: how unstable the regime is
    feat["vol_of_vol"] = vol_short.rolling(30).std(ddof=0) / vol_short.rolling(30).mean().replace(0.0, np.nan)

    feat["rsi"] = (_rsi(close) - 50.0) / 50.0

    macd = _ema(close, 12) - _ema(close, 26)
    signal = _ema(macd, 9)
    feat["macd_hist"] = (macd - signal) / close

    sma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std(ddof=0)
    feat["bb_pct"] = (close - sma20) / (2.0 * std20.replace(0.0, np.nan))
    feat["zscore"] = (close - sma20) / std20.replace(0.0, np.nan)
    momentum = np.log(close).diff(8)
    feat["momentum"] = momentum
    feat["mom_accel"] = momentum - momentum.shift(8)  # change in momentum

    feat["range_pct"] = (high - low) / close
    feat["body_pct"] = (close - open_) / (high - low).replace(0.0, np.nan)

    # breakout context: distance from recent high/low (mean-reversion vs breakout)
    roll_hi = high.rolling(60).max()
    roll_lo = low.rolling(60).min()
    span = (roll_hi - roll_lo).replace(0.0, np.nan)
    feat["dist_hi"] = (roll_hi - close) / span
    feat["dist_lo"] = (close - roll_lo) / span

    feat["volume_z"] = _zscore(volume, 60)
    feat["trades_z"] = _zscore(df["trades"].astype(float), 60)

    # order-flow: taker-buy share and its dynamics
    taker_ratio = (df["taker_buy_base"].astype(float) / volume).clip(0.0, 1.0)
    feat["taker_buy_ratio"] = taker_ratio - 0.5
    feat["taker_buy_dev"] = taker_ratio - taker_ratio.rolling(60).mean()
    feat["taker_buy_mom"] = taker_ratio.rolling(5).mean() - taker_ratio.rolling(20).mean()

    minute_of_day = (
        df["open_time"].dt.hour * 60 + df["open_time"].dt.minute
        if "open_time" in df.columns
        else pd.Series(0, index=df.index)
    )
    angle = 2 * np.pi * minute_of_day / (24 * 60)
    feat["time_sin"] = np.sin(angle)
    feat["time_cos"] = np.cos(angle)

    feat = feat[FEATURE_COLUMNS]
    feat = feat.replace([np.inf, -np.inf], np.nan)
    return feat


def build_features_aligned(klines: pd.DataFrame) -> tuple[pd.DataFrame, pd.Index]:
    """Features with warmup NaN rows removed; returns (features, kept_index)."""
    feat = build_features(klines)
    valid = feat.dropna()
    return valid, valid.index
