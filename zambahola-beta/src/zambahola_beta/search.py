"""Phase-2 edge search.

Systematically sweeps (interval x horizon x barrier_mult x confidence margin) and
ranks configurations by out-of-sample, cost-aware risk-adjusted edge. This is how
we *find* a tradeable region instead of guessing — the verdict stays honest.

Efficiency: features are computed once per interval; only labels + walk-forward
are recomputed per (horizon, barrier_mult); thresholds are swept on cached OOS
predictions (cheap).
"""

from __future__ import annotations

import itertools
from dataclasses import replace

import pandas as pd

from .backtest import run_backtest
from .config import Config
from .data import fetch_klines, load_klines, save_klines
from .features import FEATURE_COLUMNS, build_features
from .labels import triple_barrier
from .micro_features import MICRO_FEATURE_COLUMNS, build_micro_features
from .model import walk_forward_eval

DEFAULT_INTERVALS = ("5m", "15m", "1h")
DEFAULT_HORIZONS = (4, 8, 16)
DEFAULT_BARRIER_MULTS = (1.0, 1.5, 2.0)
DEFAULT_MARGINS = (0.06, 0.08, 0.10)

LEADERBOARD_COLUMNS = [
    "interval", "horizon", "barrier_mult", "margin",
    "auc", "n_trades", "directional_accuracy",
    "gross_return", "net_return", "expectancy", "sharpe", "max_drawdown", "has_edge",
]

# Micro search defaults: longer horizons (in 1s bars) so a predictable move can
# exceed costs, wider barriers, and higher-confidence-only thresholds.
MICRO_HORIZONS = (30, 60, 120, 300)
MICRO_BARRIER_MULTS = (1.0, 2.0, 4.0)
MICRO_MARGINS = (0.10, 0.15, 0.20)


def _get_klines(cfg: Config, *, fetch: bool, provided: pd.DataFrame | None) -> pd.DataFrame:
    if provided is not None:
        return provided
    path = cfg.klines_path()
    if fetch or not path.exists():
        df = fetch_klines(cfg.symbol, cfg.interval, cfg.bars)
        save_klines(df, path)
        return df
    return load_klines(path)


def run_search(
    base: Config,
    *,
    intervals=DEFAULT_INTERVALS,
    horizons=DEFAULT_HORIZONS,
    barrier_mults=DEFAULT_BARRIER_MULTS,
    margins=DEFAULT_MARGINS,
    bars: int | None = None,
    fetch: bool = True,
    klines_by_interval: dict[str, pd.DataFrame] | None = None,
) -> pd.DataFrame:
    bars = bars or base.bars
    rows: list[dict] = []

    for interval in intervals:
        cfg_i = replace(base, interval=interval, bars=bars)
        provided = (klines_by_interval or {}).get(interval)
        klines = _get_klines(cfg_i, fetch=fetch, provided=provided)
        feats = build_features(klines)  # interval-invariant to horizon/mult

        for horizon, mult in itertools.product(horizons, barrier_mults):
            cfg = replace(
                cfg_i,
                horizon=horizon,
                barrier_mult=mult,
                embargo=max(base.embargo, horizon * 2),
            )
            labels = triple_barrier(klines, cfg.horizon, cfg.vol_window, cfg.barrier_mult)
            data = feats.copy()
            data["label"] = labels.label
            data["ret"] = labels.ret
            data = data.dropna(subset=[*FEATURE_COLUMNS, "label", "ret"]).reset_index(drop=True)

            try:
                wf = walk_forward_eval(data, cfg)
            except ValueError:
                continue
            auc = wf.mean_metric("auc")

            for m in margins:
                cfg_bt = replace(cfg, long_threshold=0.5 + m, short_threshold=0.5 - m)
                bt = run_backtest(wf.oos, cfg_bt)
                rows.append(_row(interval, horizon, mult, m, auc, bt))

    return pd.DataFrame(rows, columns=LEADERBOARD_COLUMNS)


def _row(interval, horizon, mult, margin, auc, bt) -> dict:
    return {
        "interval": interval,
        "horizon": horizon,
        "barrier_mult": mult,
        "margin": margin,
        "auc": auc,
        "n_trades": bt["n_trades"],
        "directional_accuracy": bt["directional_accuracy"],
        "gross_return": bt["gross_return"],
        "net_return": bt["net_return"],
        "expectancy": bt["expectancy"],
        "sharpe": bt["sharpe"],
        "max_drawdown": bt["max_drawdown"],
        "has_edge": bool(bt["n_trades"] >= 30 and bt["net_return"] > 0 and bt["expectancy"] > 0),
    }


def run_micro_search(
    base: Config,
    micro: pd.DataFrame,
    *,
    horizons=MICRO_HORIZONS,
    barrier_mults=MICRO_BARRIER_MULTS,
    margins=MICRO_MARGINS,
) -> pd.DataFrame:
    """Sweep horizon x barrier x confidence-margin on recorded micro bars."""
    feats = build_micro_features(micro)
    rows: list[dict] = []
    for horizon, mult in itertools.product(horizons, barrier_mults):
        cfg = replace(base, horizon=horizon, barrier_mult=mult, embargo=max(base.embargo, horizon * 2))
        labels = triple_barrier(micro, cfg.horizon, cfg.vol_window, cfg.barrier_mult)
        data = feats.copy()
        data["label"] = labels.label
        data["ret"] = labels.ret
        data = data.dropna(subset=[*MICRO_FEATURE_COLUMNS, "label", "ret"]).reset_index(drop=True)
        try:
            wf = walk_forward_eval(data, cfg)
        except ValueError:
            continue
        auc = wf.mean_metric("auc")
        for m in margins:
            cfg_bt = replace(cfg, long_threshold=0.5 + m, short_threshold=0.5 - m)
            bt = run_backtest(wf.oos, cfg_bt)
            rows.append(_row("micro", horizon, mult, m, auc, bt))
    return pd.DataFrame(rows, columns=LEADERBOARD_COLUMNS)


def rank_leaderboard(lb: pd.DataFrame, *, min_trades: int = 50) -> pd.DataFrame:
    """Best configs first: positive net edge with enough trades, by Sharpe."""
    if lb.empty:
        return lb
    cand = lb[lb["n_trades"] >= min_trades].copy()
    cand = cand.sort_values(["net_return", "sharpe"], ascending=False)
    return cand.reset_index(drop=True)
