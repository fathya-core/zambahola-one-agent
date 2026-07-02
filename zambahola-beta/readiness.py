#!/usr/bin/env python3
"""ZAMBAHOLA — daily readiness / directional-performance tracker (CLI view).

The dashboard computes the same numbers automatically (data/READINESS.json and
/api/readiness); this is just a manual text view sharing the exact same logic
from zambahola_beta.perf.

Usage:
    python readiness.py
    python readiness.py --trades PATH
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))
sys.stdout.reconfigure(encoding="utf-8")

from zambahola_beta.perf import GATE_HIT, MIN_TRADES, readiness  # noqa: E402

HERE = Path(__file__).resolve().parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trades", default=str(HERE / "data" / "trades.jsonl"))
    args = ap.parse_args()

    a = readiness(args.trades)
    pf_s = "∞" if a["profit_factor"] is None else f"{a['profit_factor']:.2f}"

    print("=" * 52)
    print("  ZAMBAHOLA — تقرير جاهزية الأداء")
    print("=" * 52)
    print(f"  صفقات مغلقة        : {a['closed']}")
    print(f"  رابحة / خاسرة      : {a['wins']} / {a['losses']}")
    print(f"  نسبة الإصابة       : {a['hit_rate']:.1f}%   (المطلوب ≥ {GATE_HIT:.0f}%)")
    print(f"  عامل الربح (PF)    : {pf_s}   (جيد ≥ 1.5)")
    print(f"  التوقع/صفقة        : ${a['expectancy_usd']:.2f}")
    print(f"  ربح محقّق صافٍ     : ${a['realized_total']:.2f}")
    print(f"  متوسط ربح/خسارة %  : +{a['avg_win_pct']:.2f}% / {a['avg_loss_pct']:.2f}%")
    print(f"  أفضل / أسوأ صفقة % : +{a['best_pct']:.2f}% / {a['worst_pct']:.2f}%")
    print(f"  إجمالي الرسوم      : ${a['fees']:.2f}")
    print("-" * 52)
    print(f"  [{'✓' if a['closed'] >= MIN_TRADES else '✗'}] عيّنة كافية (≥{MIN_TRADES}): {a['closed']}")
    print(f"  [{'✓' if a['hit_rate'] >= GATE_HIT else '✗'}] نسبة إصابة ≥ {GATE_HIT:.0f}%")
    print(f"  [{'✓' if (a['profit_factor'] is None or a['profit_factor'] >= 1.5) else '✗'}] عامل ربح ≥ 1.5")
    print("-" * 52)
    if a["ready"]:
        print("  ✅ GO — مؤهّل للانتقال لرأس مال حقيقي صغير")
    elif a["need_more"] > 0:
        print(f"  ⏳ NO-GO — يلزم {a['need_more']} صفقة إضافية قبل حكم موثوق")
    else:
        print("  🔴 NO-GO — الأداء لم يبلغ العتبة بعد؛ ابقَ على testnet")
    print("=" * 52)
    return 0 if a["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
