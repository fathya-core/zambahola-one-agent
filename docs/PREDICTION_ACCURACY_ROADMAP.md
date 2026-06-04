# Prediction accuracy roadmap

## Implemented (v0.1)

| Method | Module | Effect |
|--------|--------|--------|
| 6-strategy ensemble | `prediction-engine/ensemble.ts` | Reduces single-indicator noise |
| Adaptive weights | `learning/adaptive-weights.ts` | Up-weights strategies that hit |
| Agreement score | `Prediction.meta.agreement` | Filters low-consensus signals |
| Per-strategy hit stats | `AgentMetrics.strategyStats` | Observability |
| Research log | `knowledge/research-log.jsonl` | Audit trail |

## Next (highest impact)

1. **Live Binance/Bybit feed** — real microstructure
2. **Feature store** — returns, vol, order-book proxy (when live)
3. **ML classifier** — logistic / small GBDT on features (López de Prado labeling)
4. **Regime gating** — only trade momentum in trend, reversion in range
5. **Confidence calibration** — isotonic regression on `confidence` vs hit rate
6. **Sentiment** — headline features from public RSS/API (no keys in repo)

## Research loop

```bash
npm run agent:learn   # multi-cycle paper run + weight updates
npm run agent:test-run
```

Weights persist in `apps/one-agent/data/learning/strategy-weights.json`.

## Honest limits

- Mock feed ≠ real BTCUSDT microstructure
- 30s horizon is noisy; hit rate will vary
- No method guarantees profit or 100% accuracy
