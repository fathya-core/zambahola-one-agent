"""Performance / readiness analytics for the live ledger.

Pure functions so both the CLI tracker (readiness.py) and the dashboard
(webapp background loop) share one source of truth for the GO/NO-GO gate.
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path

MIN_TRADES = 50       # sample size for a trustworthy verdict
GATE_HIT = 58.0       # directional hit-rate %% required (AGENTS.md paper-mode rule)
GATE_PF = 1.5         # profit factor required


def load_trades(path: str | Path) -> list[dict]:
    p = Path(path)
    rows: list[dict] = []
    if not p.exists():
        return rows
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def analyse(trades: list[dict]) -> dict:
    """Every SELL that booked realized PnL is one closed directional outcome."""
    closed = [t for t in trades
              if t.get("side") == "SELL" and t.get("realized") is not None
              and t.get("why") != "reconcile-phantom"]
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
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else (float("inf") if gross_win > 0 else 0.0)
    expectancy = (realized_total / n) if n else 0.0

    enough = n >= MIN_TRADES
    passes_hit = hit_rate >= GATE_HIT
    passes_pf = profit_factor >= GATE_PF
    ready = enough and passes_hit and passes_pf
    verdict = "GO" if ready else ("NO-GO: sample" if not enough else "NO-GO: perf")

    return {
        "closed": n, "wins": len(wins), "losses": len(losses),
        "hit_rate": round(hit_rate, 1),
        "profit_factor": (None if profit_factor == float("inf") else round(profit_factor, 2)),
        "expectancy_usd": round(expectancy, 2),
        "realized_total": round(realized_total, 2),
        "gross_win": round(gross_win, 2), "gross_loss": round(gross_loss, 2),
        "fees": round(fees, 2),
        "avg_win_pct": round(statistics.mean(win_pct), 2) if win_pct else 0.0,
        "avg_loss_pct": round(statistics.mean(loss_pct), 2) if loss_pct else 0.0,
        "best_pct": round(max(gains_pct), 2) if gains_pct else 0.0,
        "worst_pct": round(min(gains_pct), 2) if gains_pct else 0.0,
        "min_trades": MIN_TRADES, "gate_hit": GATE_HIT, "gate_pf": GATE_PF,
        "need_more": max(0, MIN_TRADES - n),
        "ready": ready, "verdict": verdict,
    }


def readiness(trades_path: str | Path) -> dict:
    return analyse(load_trades(trades_path))
