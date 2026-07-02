#!/usr/bin/env python3
"""ZAMBAHOLA — daily readiness / directional-performance tracker.

Reads the live ledger of executed trades (data/trades.jsonl) and prints an
honest scorecard: directional hit-rate, profit factor, expectancy, and a
GO / NO-GO gate for switching real capital on.

The project rule (AGENTS.md): stay on paper until the *directional* hit-rate is
>= 58% over a statistically meaningful sample (>= 50 closed trades).

Usage:
    python readiness.py                 # uses data/trades.jsonl + data/equity_history.json
    python readiness.py --trades PATH   # custom ledger
    python readiness.py --min-trades 50 --gate 58
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

HERE = Path(__file__).resolve().parent


def _load_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def analyse(trades: list[dict]) -> dict:
    """Every SELL that booked realized PnL is one closed (directional) outcome."""
    closed = [t for t in trades
              if t.get("side") == "SELL" and t.get("realized") is not None
              and t.get("why") != "reconcile-phantom"]  # skip bookkeeping cleanups
    wins = [t for t in closed if float(t.get("realized", 0)) > 0]
    losses = [t for t in closed if float(t.get("realized", 0)) < 0]
    n = len(closed)

    gains_pct = [float(t["gain_pct"]) for t in closed if t.get("gain_pct") is not None]
    win_pct = [float(t["gain_pct"]) for t in wins if t.get("gain_pct") is not None]
    loss_pct = [float(t["gain_pct"]) for t in losses if t.get("gain_pct") is not None]

    gross_win = sum(float(t["realized"]) for t in wins)
    gross_loss = abs(sum(float(t["realized"]) for t in losses))
    realized_total = sum(float(t["realized"]) for t in closed)
    fees = sum(float(t.get("fee", 0)) for t in trades)

    hit_rate = (len(wins) / n * 100) if n else 0.0
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else float("inf")
    expectancy = (realized_total / n) if n else 0.0
    avg_win = statistics.mean(win_pct) if win_pct else 0.0
    avg_loss = statistics.mean(loss_pct) if loss_pct else 0.0

    return {
        "closed": n, "wins": len(wins), "losses": len(losses),
        "hit_rate": hit_rate, "profit_factor": profit_factor,
        "expectancy_usd": expectancy, "realized_total": realized_total,
        "gross_win": gross_win, "gross_loss": gross_loss, "fees": fees,
        "avg_win_pct": avg_win, "avg_loss_pct": avg_loss,
        "best_pct": max(gains_pct) if gains_pct else 0.0,
        "worst_pct": min(gains_pct) if gains_pct else 0.0,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trades", default=str(HERE / "data" / "trades.jsonl"))
    ap.add_argument("--equity", default=str(HERE / "data" / "equity_history.json"))
    ap.add_argument("--min-trades", type=int, default=50)
    ap.add_argument("--gate", type=float, default=58.0, help="directional hit-rate %% required")
    args = ap.parse_args()

    trades = _load_jsonl(Path(args.trades))
    a = analyse(trades)

    pf = a["profit_factor"]
    pf_s = "∞" if pf == float("inf") else f"{pf:.2f}"

    print("=" * 52)
    print("  ZAMBAHOLA — تقرير جاهزية الأداء")
    print("=" * 52)
    print(f"  صفقات مغلقة        : {a['closed']}")
    print(f"  رابحة / خاسرة      : {a['wins']} / {a['losses']}")
    print(f"  نسبة الإصابة       : {a['hit_rate']:.1f}%   (المطلوب ≥ {args.gate:.0f}%)")
    print(f"  عامل الربح (PF)    : {pf_s}   (جيد ≥ 1.5)")
    print(f"  التوقع/صفقة        : ${a['expectancy_usd']:.2f}")
    print(f"  ربح محقّق صافٍ     : ${a['realized_total']:.2f}")
    print(f"  متوسط ربح/خسارة %  : +{a['avg_win_pct']:.2f}% / {a['avg_loss_pct']:.2f}%")
    print(f"  أفضل / أسوأ صفقة % : +{a['best_pct']:.2f}% / {a['worst_pct']:.2f}%")
    print(f"  إجمالي الرسوم      : ${a['fees']:.2f}")

    # readiness gate
    enough = a["closed"] >= args.min_trades
    passes_hit = a["hit_rate"] >= args.gate
    passes_pf = pf >= 1.5
    print("-" * 52)
    print(f"  [{'✓' if enough else '✗'}] عيّنة كافية (≥{args.min_trades} صفقة): {a['closed']}")
    print(f"  [{'✓' if passes_hit else '✗'}] نسبة إصابة ≥ {args.gate:.0f}%")
    print(f"  [{'✓' if passes_pf else '✗'}] عامل ربح ≥ 1.5")
    ready = enough and passes_hit and passes_pf
    print("-" * 52)
    if ready:
        print("  ✅ GO — مؤهّل للانتقال لرأس مال حقيقي صغير")
    elif not enough:
        need = args.min_trades - a["closed"]
        print(f"  ⏳ NO-GO — يلزم {need} صفقة إضافية قبل حكم موثوق")
    else:
        print("  🔴 NO-GO — الأداء لم يبلغ العتبة بعد؛ ابقَ على testnet")
    print("=" * 52)
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
