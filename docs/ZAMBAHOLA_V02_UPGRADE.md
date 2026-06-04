# ZAMBAHOLA v0.2 — Maximum Intelligence Upgrade

## Stack

```
Binance Hybrid Feed (WS → REST fallback)
        ↓
Feature extraction (10 dims)
        ↓
6-strategy ensemble + Online ML (logistic SGD)
        ↓
Regime gate + Sentiment (Fear/Greed + RSS)
        ↓
Confidence calibration
        ↓
Smart decision engine (dynamic thresholds)
        ↓
Paper broker + Evaluator → adaptive weights + ML train
```

## Engines

| Component | File |
|-----------|------|
| Hybrid Binance | `market-feed/hybrid-binance.ts` |
| Features | `features/index.ts` |
| ML online | `prediction-engine/ml-model.ts` |
| Regime gate | `prediction-engine/regime-gate.ts` |
| Calibration | `learning/calibration.ts` |
| Sentiment | `sentiment/index.ts` |
| Hybrid predictor | `prediction-engine/index.ts` (`hybrid_v2`) |

## Environment

```bash
ZAMBAHOLA_FEED=binance      # default — hybrid WS/REST
ZAMBAHOLA_FEED=mock         # offline / CI
ZAMBAHOLA_FEED=binance_rest # REST only
ZAMBAHOLA_LEARN_CYCLES=10    # extended learning
```

## Commands

```bash
npm run setup
npm run agent:start
npm run agent:learn
npm run agent:turbo-learn
```

## Persistence

- `data/learning/strategy-weights.json`
- `data/learning/ml-weights.json`
- `data/learning/calibration.json`
- `knowledge/research-log.jsonl`

## Next (v0.3)

- Order book features (Binance depth stream)
- LSTM / ONNX model export
- Bybit failover
- Backtest CLI on historical klines
