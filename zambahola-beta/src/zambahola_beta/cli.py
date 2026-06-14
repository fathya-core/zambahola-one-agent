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

import pandas as pd

from .config import Config
from .data import fetch_klines, load_klines, save_klines, synthetic_klines
from .pipeline import run_micro_maker, run_micro_pipeline, run_pipeline
from .search import (
    DEFAULT_BARRIER_MULTS,
    DEFAULT_HORIZONS,
    DEFAULT_INTERVALS,
    DEFAULT_MARGINS,
    rank_leaderboard,
    run_micro_search,
    run_search,
)


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

    p_record = sub.add_parser("record", parents=[common], help="record live L2 microstructure")
    p_record.add_argument("--seconds", type=float, default=60.0)
    p_record.add_argument("--bar-ms", dest="bar_ms", type=int, default=1000)

    sub.add_parser("micro-run", parents=[common], help="run pipeline on recorded micro data")

    p_maker = sub.add_parser("micro-maker", parents=[common], help="maker-execution analysis")
    p_maker.add_argument("--maker-fee-bps", dest="maker_fee_bps", type=float, default=1.0)

    p_alloc = sub.add_parser("allocate", parents=[common], help="long-term trend allocation vs HODL")
    p_alloc.add_argument("--cost-bps", dest="alloc_cost_bps", type=float, default=10.0)

    p_pf = sub.add_parser("portfolio", parents=[common], help="thinking allocator vs SMA100/HODL")
    p_pf.add_argument("--assets", default="BTCUSDT,ETHUSDT")
    p_pf.add_argument("--cost-bps", dest="alloc_cost_bps", type=float, default=10.0)
    p_pf.add_argument("--target-vol", dest="target_vol", type=float, default=0.6)
    p_pf.add_argument("--max-total", dest="max_total", type=float, default=1.0)

    p_sig = sub.add_parser("signal", parents=[common], help="today's target allocation (live advisor)")
    p_sig.add_argument("--assets", default="BTCUSDT,ETHUSDT")
    p_sig.add_argument("--mode", default="ensemble", choices=["ensemble", "rotation"])
    p_sig.add_argument("--target-vol", dest="target_vol", type=float, default=0.6)
    p_sig.add_argument("--max-total", dest="max_total", type=float, default=1.0)

    p_con = sub.add_parser("console", parents=[common], help="launch the web dashboard (everything, no commands)")
    p_con.add_argument("--assets", default="BTCUSDT,ETHUSDT")
    p_con.add_argument("--port", type=int, default=8799)
    p_con.add_argument("--live", action="store_true", help="REAL money mode (needs env confirm)")
    p_con.add_argument("--max-order-usd", dest="max_order_usd", type=float, default=20.0)
    p_con.add_argument("--max-total-usd", dest="max_total_usd", type=float, default=100.0)

    p_exec = sub.add_parser("execute", parents=[common], help="rebalance to target (testnet+dry-run by default)")
    p_exec.add_argument("--assets", default="BTCUSDT,ETHUSDT")
    p_exec.add_argument("--mode", default="ensemble", choices=["ensemble", "rotation"])
    p_exec.add_argument("--target-vol", dest="target_vol", type=float, default=0.6)
    p_exec.add_argument("--live", action="store_true", help="REAL money (needs env confirm); default testnet")
    p_exec.add_argument("--execute", action="store_true", help="place orders; default dry-run")
    p_exec.add_argument("--max-order-usd", dest="max_order_usd", type=float, default=20.0)
    p_exec.add_argument("--max-total-usd", dest="max_total_usd", type=float, default=100.0)

    p_cross = sub.add_parser("cross-search", parents=[common], help="cross-asset lead-lag search")
    p_cross.add_argument("--targets", default="SOLUSDT,DOGEUSDT,XRPUSDT,ADAUSDT,AVAXUSDT")
    p_cross.add_argument("--leaders", default="BTCUSDT,ETHUSDT")
    p_cross.add_argument("--horizons", default="4,8,16")
    p_cross.add_argument("--mults", default="1.0,2.0")
    p_cross.add_argument("--margins", default="0.08,0.12")
    p_cross.add_argument("--top", type=int, default=15)

    p_msearch = sub.add_parser("micro-search", parents=[common], help="grid-search micro edge")
    p_msearch.add_argument("--horizons", default="30,60,120,300")
    p_msearch.add_argument("--mults", default="1.0,2.0,4.0")
    p_msearch.add_argument("--margins", default="0.10,0.15,0.20")
    p_msearch.add_argument("--top", type=int, default=12)

    p_search = sub.add_parser("search", parents=[common], help="grid-search for an edge")
    p_search.add_argument("--intervals", default=",".join(DEFAULT_INTERVALS))
    p_search.add_argument("--horizons", default=",".join(str(h) for h in DEFAULT_HORIZONS))
    p_search.add_argument("--mults", default=",".join(str(m) for m in DEFAULT_BARRIER_MULTS))
    p_search.add_argument("--margins", default=",".join(str(m) for m in DEFAULT_MARGINS))
    p_search.add_argument("--top", type=int, default=12)
    p_search.add_argument("--no-fetch", action="store_true", help="use cached parquet")

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

    if args.command == "record":
        import asyncio

        from .recorder import micro_dir, record

        try:
            written = asyncio.run(
                record(
                    symbol=cfg.symbol,
                    duration_sec=args.seconds,
                    bar_ms=args.bar_ms,
                    data_dir=cfg.data_dir,
                )
            )
        except KeyboardInterrupt:
            written = []
        print(f"[beta] recorded {len(written)} file(s) in {micro_dir(cfg.data_dir)}")
        return 0

    if args.command == "micro-run":
        report = run_micro_pipeline(cfg)
        _print_report(report)
        return 0

    if args.command == "micro-maker":
        report = run_micro_maker(cfg, maker_fee_bps=args.maker_fee_bps)
        print(json.dumps(report, indent=2))
        return 0

    if args.command == "micro-search":
        from .recorder import load_micro

        micro = load_micro(cfg.data_dir)
        lb = run_micro_search(
            cfg,
            micro,
            horizons=[int(s) for s in args.horizons.split(",") if s.strip()],
            barrier_mults=[float(s) for s in args.mults.split(",") if s.strip()],
            margins=[float(s) for s in args.margins.split(",") if s.strip()],
        )
        ranked = rank_leaderboard(lb, min_trades=20)
        cfg.reports_dir.mkdir(parents=True, exist_ok=True)
        out = cfg.reports_dir / "micro_search_leaderboard.csv"
        lb.to_csv(out, index=False)
        print(f"[beta] {len(lb)} configs · with-edge: {int(lb['has_edge'].sum())} · bars: {len(micro)}")
        print(f"[beta] leaderboard -> {out}\n")
        if ranked.empty:
            print("No config met the trade-count threshold. Record more data or widen grid.")
        else:
            with pd.option_context("display.width", 220, "display.max_columns", 20):
                print(ranked.head(args.top).to_string(index=False))
        return 0

    if args.command == "allocate":
        from .allocation import compare_strategies

        path = cfg.klines_path()
        if getattr(args, "no_fetch", False) and path.exists():
            klines = load_klines(path)
        else:
            klines = fetch_klines(cfg.symbol, cfg.interval, cfg.bars)
            save_klines(klines, path)
        table = compare_strategies(klines, cost_bps=args.alloc_cost_bps)
        print(f"[beta] {cfg.symbol} {cfg.interval} · {len(klines)} bars · cost {args.alloc_cost_bps}bps/switch\n")
        with pd.option_context("display.width", 200, "display.max_columns", 20):
            print(table.to_string(index=False))
        hodl = table[table["strategy"] == "HODL"].iloc[0]
        best = table.iloc[0]
        print(
            f"\n[beta] best by Calmar: {best['strategy']} "
            f"(CAGR {best['cagr']:.1%}, maxDD {best['max_drawdown']:.1%}, Calmar {best['calmar']}) "
            f"vs HODL (CAGR {hodl['cagr']:.1%}, maxDD {hodl['max_drawdown']:.1%})"
        )
        return 0

    if args.command in ("portfolio", "signal"):
        from .data import fetch_many
        from .strategy import compare_portfolios, current_allocation

        symbols = [s.strip() for s in args.assets.split(",") if s.strip()]
        frames = fetch_many(symbols, interval=cfg.interval, total=cfg.bars)

        if args.command == "portfolio":
            table = compare_portfolios(
                frames, cost_bps=args.alloc_cost_bps,
                target_vol=args.target_vol, max_total=args.max_total,
            )
            print(f"[beta] portfolio {symbols} {cfg.interval} · {cfg.bars} bars\n")
            with pd.option_context("display.width", 200, "display.max_columns", 20):
                print(table.to_string(index=False))
            best = table.iloc[0]
            print(f"\n[beta] best by Calmar: {best['strategy']} "
                  f"(CAGR {best['cagr']:.1%}, maxDD {best['max_drawdown']:.1%}, Sharpe {best['sharpe']})")
            return 0

        alloc = current_allocation(
            frames, mode=args.mode, target_vol=args.target_vol, max_total=args.max_total
        )
        print(json.dumps(alloc, indent=2))
        print("\n[beta] ACTION:")
        for sym, r in alloc["reasons"].items():
            print(f"  {sym}: {r['action']}  (target {int(r['target_weight']*100)}% · "
                  f"trend {int(r['trend_consensus']*100)}% · price {r['price']})")
        print(f"  CASH: {int(alloc['cash_weight']*100)}%")
        return 0

    if args.command == "console":
        from .webapp import AppConfig, main as run_console

        # the validated strategy is daily; default to 1d unless explicitly overridden
        interval = args.interval or "1d"
        run_console(
            AppConfig(
                assets=tuple(s.strip() for s in args.assets.split(",") if s.strip()),
                interval=interval,
                mode="ensemble",
                live=bool(args.live),
                max_order_usd=args.max_order_usd,
                max_total_usd=args.max_total_usd,
                port=args.port,
            )
        )
        return 0

    if args.command == "execute":
        return _run_execute(cfg, args)

    if args.command == "cross-search":
        from .cross import rank_cross, run_cross_search
        from .data import fetch_many

        targets = [s.strip() for s in args.targets.split(",") if s.strip()]
        leaders = [s.strip() for s in args.leaders.split(",") if s.strip()]
        symbols = sorted(set(targets) | set(leaders))
        frames = fetch_many(symbols, interval=cfg.interval, total=cfg.bars)
        lb = run_cross_search(
            cfg,
            {t: frames[t] for t in targets},
            {ldr: frames[ldr] for ldr in leaders},
            horizons=[int(s) for s in args.horizons.split(",") if s.strip()],
            barrier_mults=[float(s) for s in args.mults.split(",") if s.strip()],
            margins=[float(s) for s in args.margins.split(",") if s.strip()],
        )
        ranked = rank_cross(lb)
        cfg.reports_dir.mkdir(parents=True, exist_ok=True)
        out = cfg.reports_dir / "cross_search_leaderboard.csv"
        lb.to_csv(out, index=False)
        print(f"[beta] {len(lb)} configs · with-edge: {int(lb['has_edge'].sum())} · leaders={leaders}")
        print(f"[beta] leaderboard -> {out}\n")
        if ranked.empty:
            print("No config met the trade-count threshold.")
        else:
            with pd.option_context("display.width", 220, "display.max_columns", 20):
                print(ranked.head(args.top).to_string(index=False))
        return 0

    if args.command == "search":
        lb = run_search(
            cfg,
            intervals=[s.strip() for s in args.intervals.split(",") if s.strip()],
            horizons=[int(s) for s in args.horizons.split(",") if s.strip()],
            barrier_mults=[float(s) for s in args.mults.split(",") if s.strip()],
            margins=[float(s) for s in args.margins.split(",") if s.strip()],
            fetch=not args.no_fetch,
        )
        ranked = rank_leaderboard(lb)
        cfg.reports_dir.mkdir(parents=True, exist_ok=True)
        out = cfg.reports_dir / "search_leaderboard.csv"
        lb.to_csv(out, index=False)
        print(f"[beta] {len(lb)} configs tested · with-edge: {int(lb['has_edge'].sum())}")
        print(f"[beta] leaderboard -> {out}\n")
        if ranked.empty:
            print("No config met the trade-count threshold. Widen the grid or data.")
        else:
            with pd.option_context("display.width", 200, "display.max_columns", 20):
                print(ranked.head(args.top).to_string(index=False))
            best = ranked.iloc[0]
            verdict = "EDGE after costs" if bool(best["has_edge"]) else "still no positive edge"
            print(f"\n[beta] best: {best['interval']} h={int(best['horizon'])} "
                  f"mult={best['barrier_mult']} margin={best['margin']} -> {verdict}")
        return 0

    parser.error("unknown command")
    return 2


def _run_execute(cfg: Config, args: argparse.Namespace) -> int:
    from .data import fetch_many
    from .executor import (
        BinanceSpot,
        RiskLimits,
        load_keys,
        mask,
        plan_rebalance,
        safety_gate,
    )
    from .strategy import current_allocation

    live = bool(args.live)
    do_execute = bool(args.execute)
    try:
        safety_gate(live=live)
    except RuntimeError as exc:
        print(f"[beta] {exc}")
        return 1

    symbols = [s.strip() for s in args.assets.split(",") if s.strip()]
    print(f"[beta] mode={'LIVE' if live else 'TESTNET'} · {'EXECUTE' if do_execute else 'DRY-RUN'} · {symbols}")

    # 1) target allocation from the validated trend signal
    frames = fetch_many(symbols, interval=cfg.interval, total=max(cfg.bars, 400))
    alloc = current_allocation(frames, mode=args.mode, target_vol=args.target_vol)
    targets = alloc["targets"]
    print(f"[beta] targets: {targets} · cash {int(alloc['cash_weight'] * 100)}%")

    # 2) connect (keys loaded from env/file, never logged)
    try:
        keys = load_keys()
    except RuntimeError as exc:
        print(f"[beta] {exc}")
        return 1
    print(f"[beta] key {mask(keys.api_key)} · secret {mask(keys.api_secret)}")
    client = BinanceSpot(keys, testnet=not live)

    try:
        prices = {s: client.price(s) for s in symbols}
        balances = client.balances()
    except Exception as exc:  # network/auth errors
        print(f"[beta] exchange error (check keys/testnet access): {exc}")
        return 1

    limits = RiskLimits(
        max_order_usd=args.max_order_usd,
        max_total_usd=args.max_total_usd,
        whitelist=tuple(symbols),
    )
    plan = plan_rebalance(targets, balances, prices, limits)
    print(f"[beta] equity ${plan.equity_usd} · deployable ${plan.deployable_usd}")
    for note in plan.notes:
        print(f"   note: {note}")
    if not plan.orders:
        print("[beta] no rebalance needed (already aligned within limits).")
        return 0
    for o in plan.orders:
        print(f"   {o.side} {o.symbol} ~${o.usd}  ({o.reason})")

    if not do_execute:
        print("[beta] DRY-RUN — nothing placed. Re-run with --execute to place orders.")
        return 0

    for o in plan.orders:
        try:
            # quoteOrderQty for both sides -> no LOT_SIZE precision issues
            res = client.market_order(o.symbol, o.side, quote_qty=o.usd)
            fills = res.get("fills") or []
            filled = sum(float(f.get("qty", 0)) for f in fills)
            print(f"   placed {o.side} {o.symbol}: orderId={res.get('orderId')} "
                  f"status={res.get('status')} filledQty={filled}")
        except Exception as exc:
            print(f"   FAILED {o.side} {o.symbol}: {exc}")
    return 0


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
