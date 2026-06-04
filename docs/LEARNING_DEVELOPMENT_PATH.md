# Learning & development path

**Status:** active — resume anytime from Phase 1.

## Phase map

| Phase | Goal | Command (cloud / CI) | Artifact |
|-------|------|----------------------|----------|
| **0 — Live** | Paper predictions + dashboard | `ZAMBAHOLA_FEED=coingecko npm run agent:start` | `data/runs/latest.jsonl`, metrics |
| **1 — Learn** | Adaptive strategy weights (25 cycles default) | `npm run agent:learn` | `data/learning/strategy-weights.json` |
| **2 — Deep** | Regime + calibration + deep backtest | `npm run agent:deep-learn` | `data/learning/*.json` |
| **3 — Mega** | Large kline train + backtest | `npm run agent:mega-train` / `agent:mega-backtest` | ML/MLP/GBM samples |
| **4 — Ultra** | Full pipeline (5000 bars + 30 cycles) | `npm run agent:ultra-learn` | orchestrator + post metrics |
| **5 — Next** | v0.7 (see `docs/PREDICTION_ACCURACY_ROADMAP.md`) | TBD | ONNX, 10k klines, sub-second ticks |

## Quick resume (started 2026-06-04)

```bash
npm run agent:path-resume   # live agent + 5 learn cycles (mock feed for cycles)
```

## Metrics to watch

- `apps/one-agent/data/metrics/current.json` — `hitRate`, `predictionCount`, `strategyStats`
- `knowledge/research-log.jsonl` — per-cycle audit (local only, gitignored)

## Arabic summary

راجع `docs/ar/مسار-التعلم-والتطوير.md`.
