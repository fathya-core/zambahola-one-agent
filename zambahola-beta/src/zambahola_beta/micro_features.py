"""Microstructure feature engineering from recorded L2/trade bars.

Order-flow imbalance (OFI), book imbalance dynamics, signed trade flow and
microprice deviation — the signal classes research attributes most short-horizon
predictive power to. All features are causal (only past/current bar).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

MICRO_FEATURE_COLUMNS = [
    "ret_1", "ret_3", "ret_5", "ret_10",
    "vol_short", "vol_ratio",
    "ofi", "ofi_sum3", "ofi_sum10", "ofi_z",
    "imb1", "imb5", "imb20", "imb_mom",
    "micro_dev", "spread_z",
    "trade_imb", "trade_imb_sum5", "trade_intensity",
    "depth_imb", "depth_z",
]


def _zscore(s: pd.Series, window: int) -> pd.Series:
    mean = s.rolling(window).mean()
    std = s.rolling(window).std(ddof=0)
    z = (s - mean) / std.replace(0.0, np.nan)
    flat = mean.notna() & (std == 0.0)
    return z.mask(flat, 0.0)


def build_micro_features(micro: pd.DataFrame) -> pd.DataFrame:
    df = micro.reset_index(drop=True).copy()
    close = df["close"].astype(float)
    log_ret = np.log(close).diff()

    feat = pd.DataFrame(index=df.index)
    feat["ret_1"] = log_ret
    feat["ret_3"] = np.log(close).diff(3)
    feat["ret_5"] = np.log(close).diff(5)
    feat["ret_10"] = np.log(close).diff(10)

    vol_short = log_ret.rolling(10).std(ddof=0)
    vol_long = log_ret.rolling(60).std(ddof=0)
    feat["vol_short"] = vol_short
    feat["vol_ratio"] = vol_short / vol_long.replace(0.0, np.nan) - 1.0

    ofi = df["ofi"].astype(float)
    feat["ofi"] = ofi
    feat["ofi_sum3"] = ofi.rolling(3).sum()
    feat["ofi_sum10"] = ofi.rolling(10).sum()
    feat["ofi_z"] = _zscore(ofi, 60)

    feat["imb1"] = df["imb1"].astype(float)
    feat["imb5"] = df["imb5"].astype(float)
    feat["imb20"] = df["imb20"].astype(float)
    feat["imb_mom"] = df["imb5"].astype(float).diff(3)

    feat["micro_dev"] = (df["microprice"].astype(float) - close) / close
    feat["spread_z"] = _zscore(df["spread_bps"].astype(float), 60)

    trade_vol = df["trade_vol"].astype(float).replace(0.0, np.nan)
    trade_imb = df["trade_signed_vol"].astype(float) / trade_vol
    trade_imb = trade_imb.fillna(0.0)
    feat["trade_imb"] = trade_imb
    feat["trade_imb_sum5"] = df["trade_signed_vol"].astype(float).rolling(5).sum()
    feat["trade_intensity"] = _zscore(df["trade_count"].astype(float), 60)

    bid = df["bid_depth"].astype(float)
    ask = df["ask_depth"].astype(float)
    depth_total = (bid + ask).replace(0.0, np.nan)
    feat["depth_imb"] = (bid - ask) / depth_total
    feat["depth_z"] = _zscore((bid + ask), 60)

    feat = feat[MICRO_FEATURE_COLUMNS].replace([np.inf, -np.inf], np.nan)
    return feat
