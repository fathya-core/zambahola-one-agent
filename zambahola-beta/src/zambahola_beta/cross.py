"""Cross-asset (lead-lag) alpha.

Large caps (BTC, ETH) tend to lead smaller alts. This module aligns a target
symbol with one or more "leader" symbols on timestamp and builds causal leader
features (recent leader returns/momentum/vol + relative strength) alongside the
target's own features, then runs the same leakage-safe, cost-aware validation.

A genuinely different signal class than single-asset OHLCV — executable now from
historical klines (no live recording needed).
"""

from __future__ import annotations

import itertools
from dataclasses import replace

import numpy as np
import pandas as pd

from .backtest import run_backtest
from .config import Config
from .features import FEATURE_COLUMNS, build_features
from .labels import triple_barrier
from .model import walk_forward_eval
from .search import LEADERBOARD_COLUMNS, _row


def align_target_leaders(
    target: pd.DataFrame, leaders: dict[str, pd.DataFrame]
) -> pd.DataFrame:
    """Inner-join target OHLCV with each leader's close on open_time."""
    merged = target.reset_index(drop=True).copy()
    for name, ldf in leaders.items():
        sub = ldf[["open_time", "close"]].rename(columns={"close": f"{name}_close"})
        merged = merged.merge(sub, on="open_time", how="inner")
    return merged.sort_values("open_time").reset_index(drop=True)


def _leader_feature_columns(leader_names: list[str]) -> list[str]:
    cols: list[str] = []
    for name in leader_names:
        cols += [f"{name}_ret1", f"{name}_ret5", f"{name}_ret15", f"{name}_mom",
                 f"{name}_vol", f"rs_{name}"]
    return cols


def build_cross_features(merged: pd.DataFrame, leader_names: list[str]) -> pd.DataFrame:
    """Target's own features + causal leader lead-lag features."""
    feat = build_features(merged)  # target OHLCV columns
    tgt_logret = np.log(merged["close"].astype(float)).diff()
    for name in leader_names:
        lc = merged[f"{name}_close"].astype(float)
        lr = np.log(lc).diff()
        feat[f"{name}_ret1"] = lr
        feat[f"{name}_ret5"] = np.log(lc).diff(5)
        feat[f"{name}_ret15"] = np.log(lc).diff(15)
        feat[f"{name}_mom"] = np.log(lc).diff(8)
        feat[f"{name}_vol"] = lr.rolling(30).std(ddof=0)
        # relative strength: target return minus leader return (recent)
        feat[f"rs_{name}"] = tgt_logret.rolling(5).sum() - lr.rolling(5).sum()
    cols = FEATURE_COLUMNS + _leader_feature_columns(leader_names)
    return feat[cols].replace([np.inf, -np.inf], np.nan)


def assemble_cross_dataset(
    target: pd.DataFrame, leaders: dict[str, pd.DataFrame], cfg: Config
) -> pd.DataFrame:
    merged = align_target_leaders(target, leaders)
    leader_names = list(leaders.keys())
    feats = build_cross_features(merged, leader_names)
    labels = triple_barrier(merged, cfg.horizon, cfg.vol_window, cfg.barrier_mult)
    data = feats.copy()
    data["label"] = labels.label
    data["ret"] = labels.ret
    feature_cols = FEATURE_COLUMNS + _leader_feature_columns(leader_names)
    data = data.dropna(subset=[*feature_cols, "label", "ret"])
    return data.sort_index().reset_index(drop=True)


def run_cross_search(
    base: Config,
    targets: dict[str, pd.DataFrame],
    leaders: dict[str, pd.DataFrame],
    *,
    horizons=(4, 8, 16),
    barrier_mults=(1.0, 2.0),
    margins=(0.08, 0.12),
) -> pd.DataFrame:
    """Sweep targets x horizon x barrier x margin with cross-asset features."""
    rows: list[dict] = []
    for tname, tdf in targets.items():
        # don't use a symbol as its own leader
        lead = {k: v for k, v in leaders.items() if k != tname}
        for horizon, mult in itertools.product(horizons, barrier_mults):
            cfg = replace(base, horizon=horizon, barrier_mult=mult,
                          embargo=max(base.embargo, horizon * 2))
            data = assemble_cross_dataset(tdf, lead, cfg)
            try:
                wf = walk_forward_eval(data, cfg)
            except ValueError:
                continue
            auc = wf.mean_metric("auc")
            for m in margins:
                cfg_bt = replace(cfg, long_threshold=0.5 + m, short_threshold=0.5 - m)
                bt = run_backtest(wf.oos, cfg_bt)
                row = _row(tname, horizon, mult, m, auc, bt)
                rows.append(row)
    return pd.DataFrame(rows, columns=LEADERBOARD_COLUMNS)


def rank_cross(lb: pd.DataFrame, *, min_trades: int = 50) -> pd.DataFrame:
    if lb.empty:
        return lb
    cand = lb[lb["n_trades"] >= min_trades].copy()
    return cand.sort_values(["has_edge", "sharpe", "net_return"], ascending=False).reset_index(drop=True)


__all__ = [
    "align_target_leaders",
    "build_cross_features",
    "assemble_cross_dataset",
    "run_cross_search",
    "rank_cross",
]
