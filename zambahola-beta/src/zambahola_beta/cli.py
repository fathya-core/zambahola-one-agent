"""Command-line entry point for ZAMBAHOLA BETA.

Examples:
  python -m zambahola_beta.cli fetch --bars 30000
  python -m zambahola_beta.cli run --bars 30000 --horizon 15
  python -m zambahola_beta.cli run --synthetic   # offline smoke run
"""

from __future__ import annotations

import argparse
import json
from dataclasses import replace

from .config import Config
from .data import fetch_klines, save_klines, synthetic_klines
from .pipeline import run_pipeline


def _cfg_from_args(args: argparse.Namespace) -> Config:
    overrides = {}
    for key in ("symbol", "interval", "bars", "horizon", "vol_window",
                "barrier_mult", "n_splits", "embargo", "fee_bps", "slippage_bps",
                "long_threshold", "short_threshold"):
        val = getattr(args, key, None)
        if val is not None:
            overrides[key] = val
    return replace(Config(), **overrides)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="zambahola-beta")
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--symbol")
    common.add_argument("--interval")
    common.add_argument("--bars", type=int)
    common.add_argument("--horizon", type=int)
    common.add_argument("--vol-window", dest="vol_window", type=int)
    common.add_argument("--barrier-mult", dest="barrier_mult", type=float)
    common.add_argument("--n-splits", dest="n_splits", type=int)
    common.add_argument("--embargo", type=int)
    common.add_argument("--fee-bps", dest="fee_bps", type=float)
    common.add_argument("--slippage-bps", dest="slippage_bps", type=float)
    common.add_argument("--long-threshold", dest="long_threshold", type=float)
    common.add_argument("--short-threshold", dest="short_threshold", type=float)

    sub.add_parser("fetch", parents=[common], help="download klines to parquet")
    p_run = sub.add_parser("run", parents=[common], help="full pipeline + backtest")
    p_run.add_argument("--synthetic", action="store_true", help="use offline synthetic data")
    p_run.add_argument("--no-fetch", action="store_true", help="use cached parquet (no download)")

    args = parser.parse_args(argv)
    cfg = _cfg_from_args(args)

    if args.command == "fetch":
        df = fetch_klines(cfg.symbol, cfg.interval, cfg.bars)
        path = save_klines(df, cfg.klines_path())
        print(f"[beta] saved {len(df)} klines -> {path}")
        return 0

    if args.command == "run":
        if getattr(args, "synthetic", False):
            klines = synthetic_klines(max(cfg.bars, 5000))
            report = run_pipeline(cfg, klines=klines)
        else:
            report = run_pipeline(cfg, fetch=not getattr(args, "no_fetch", False))
        _print_report(report)
        return 0

    parser.error("unknown command")
    return 2


def _print_report(report: dict) -> None:
    print(json.dumps(
        {
            "dataset": report["dataset"],
            "validation": {k: v for k, v in report["validation"].items() if k != "fold_metrics"},
            "backtest": report["backtest"],
            "verdict": report["verdict"],
            "report_path": report.get("report_path"),
        },
        indent=2,
    ))


if __name__ == "__main__":
    raise SystemExit(main())
