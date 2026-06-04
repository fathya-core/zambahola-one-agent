# Prediction accuracy roadmap

## Implemented (through v0.6 ULTRA)

| Method | Module | Effect |
|--------|--------|--------|
| 17-strategy ensemble | `prediction-engine/ensemble.ts` | Multi-signal consensus |
| ML + MLP + GBM + LOB-CNN | `prediction-engine/*` | `hybrid_v6_ultra` blend |
| Adaptive weights | `learning/adaptive-weights.ts` | Up-weights strategies that hit |
| Regime gate + calibration | `learning/` | Phase-aware decisions |
| Live feeds | `market-feed/universal`, `coingecko` | Binance/Bybit/CoinGecko failover |
| Sentiment + FAPI signals | `sentiment/`, `market-signals/` | Fear/greed, funding, OI |
| Research log | `knowledge/research-log.jsonl` | Audit trail (gitignored) |

## Next (v0.7 — highest impact)

1. **Sub-second default ticks** — `ZAMBAHOLA_FAST=1` as default when stable
2. **10k kline cache** — longer train windows
3. **ONNX / model export** — deployable inference artifact
4. **Bybit-primary mode** when Binance geo-blocked
5. **Deeper LOB** — more depth history for LOB-CNN

## Research loop

See **`docs/LEARNING_DEVELOPMENT_PATH.md`** — phases 0→4.

```bash
npm run agent:path-resume   # live + 5 learn cycles
npm run agent:learn         # full 25 cycles
npm run agent:ultra-learn   # mega pipeline
```

Weights persist in `apps/one-agent/data/learning/strategy-weights.json`.

## Honest limits

- Mock feed ≠ real BTCUSDT microstructure
- 30s horizon is noisy; hit rate will vary
- No method guarantees profit or 100% accuracy
