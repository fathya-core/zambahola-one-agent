"""End-to-end orchestration: data -> features -> labels -> walk-forward -> backtest."""

from __future__ import annotations

import json
import math
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .backtest import run_backtest, threshold_sweep
from .config import Config
from .data import fetch_klines, load_klines, save_klines
from .features import FEATURE_COLUMNS, build_features
from .labels import triple_barrier
from .micro_features import MICRO_FEATURE_COLUMNS, build_micro_features
from .model import walk_forward_eval


def assemble_dataset(klines: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    """Join features + labels on their common, temporally-ordered rows."""
    feats = build_features(klines)
    labels = triple_barrier(klines, cfg.horizon, cfg.vol_window, cfg.barrier_mult)

    data = feats.copy()
    data["label"] = labels.label
    data["ret"] = labels.ret
    data = data.dropna(subset=[*FEATURE_COLUMNS, "label", "ret"])
    data = data.sort_index().reset_index(drop=True)
    return data


def get_klines(cfg: Config, *, fetch: bool, klines: pd.DataFrame | None) -> pd.DataFrame:
    if klines is not None:
        return klines
    path = cfg.klines_path()
    if fetch or not path.exists():
        df = fetch_klines(cfg.symbol, cfg.interval, cfg.bars)
        save_klines(df, path)
        return df
    return load_klines(path)


def assemble_micro_dataset(micro: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    """Join microstructure features + triple-barrier labels (mid OHLC)."""
    feats = build_micro_features(micro)
    labels = triple_barrier(micro, cfg.horizon, cfg.vol_window, cfg.barrier_mult)
    data = feats.copy()
    data["label"] = labels.label
    data["ret"] = labels.ret
    data = data.dropna(subset=[*MICRO_FEATURE_COLUMNS, "label", "ret"])
    return data.sort_index().reset_index(drop=True)


def _build_report(cfg: Config, data: pd.DataFrame, source: dict, tag: str, write_report: bool) -> dict:
    wf = walk_forward_eval(data, cfg)
    bt = run_backtest(wf.oos, cfg)
    sweep = threshold_sweep(wf.oos, cfg)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "config": _config_summary(cfg),
        "dataset": {
            "samples": int(len(data)),
            "directional_samples": int((data["label"] != 0.0).sum()),
            "up_rate": float((data["label"] == 1.0).mean()),
            "timeout_rate": float((data["label"] == 0.0).mean()),
        },
        "validation": {
            "folds": len(wf.fold_metrics),
            "mean_accuracy": wf.mean_metric("accuracy"),
            "mean_auc": wf.mean_metric("auc"),
            "mean_logloss": wf.mean_metric("logloss"),
            "mean_brier": wf.mean_metric("brier"),
            "fold_metrics": wf.fold_metrics,
        },
        "backtest": bt,
        "threshold_sweep": sweep.to_dict(orient="records"),
        "verdict": _verdict(bt),
    }
    report = _jsonable(report)
    if write_report:
        cfg.reports_dir.mkdir(parents=True, exist_ok=True)
        out = cfg.reports_dir / f"report_{tag}.json"
        out.write_text(json.dumps(report, indent=2), encoding="utf-8")
        report["report_path"] = str(out)
    return report


def run_pipeline(
    cfg: Config,
    *,
    fetch: bool = False,
    klines: pd.DataFrame | None = None,
    write_report: bool = True,
) -> dict:
    raw = get_klines(cfg, fetch=fetch, klines=klines)
    data = assemble_dataset(raw, cfg)
    source = {"kind": "klines", "klines": int(len(raw)), "interval": cfg.interval}
    return _build_report(cfg, data, source, f"{cfg.symbol}_{cfg.interval}", write_report)


def run_micro_pipeline(
    cfg: Config,
    *,
    micro: pd.DataFrame | None = None,
    write_report: bool = True,
) -> dict:
    if micro is None:
        from .recorder import load_micro

        micro = load_micro(cfg.data_dir)
    data = assemble_micro_dataset(micro, cfg)
    source = {"kind": "micro", "bars": int(len(micro))}
    return _build_report(cfg, data, source, f"micro_{cfg.symbol}", write_report)


def _verdict(bt: dict) -> dict:
    """Honest go/no-go: a positive, risk-adjusted edge AFTER costs."""
    sharpe = bt.get("sharpe")
    net = bt.get("net_return", 0.0)
    expectancy = bt.get("expectancy", 0.0)
    edge = (
        bt.get("n_trades", 0) >= 30
        and expectancy is not None
        and expectancy > 0
        and net > 0
        and (sharpe is not None and not math.isnan(sharpe) and sharpe > 0.5)
    )
    return {
        "has_edge_after_costs": bool(edge),
        "note": (
            "Positive risk-adjusted edge after costs on out-of-sample data."
            if edge
            else "No reliable edge after costs yet — do NOT trade real funds."
        ),
    }


def _config_summary(cfg: Config) -> dict:
    d = asdict(cfg)
    d["data_dir"] = str(cfg.data_dir)
    d["reports_dir"] = str(cfg.reports_dir)
    d["bars_per_year"] = cfg.bars_per_year()
    return d


def _jsonable(obj):
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, float):
        return None if math.isnan(obj) or math.isinf(obj) else obj
    try:
        import numpy as np

        if isinstance(obj, np.floating):
            f = float(obj)
            return None if math.isnan(f) or math.isinf(f) else f
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
    except ImportError:
        pass
    return obj
