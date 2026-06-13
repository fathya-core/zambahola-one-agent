# v0.5 MEGA — Deepest stack

## `hybrid_v5_mega`

| Layer | Weight | Tech |
|-------|--------|------|
| Ensemble (11 strategies) | 28% | Weighted vote |
| Logistic ML | 20% | 18 features online |
| MLP 16→8 | 22% | Deep online |
| GBM stumps | 18% | 16-tree gradient boost |
| LOB-CNN proxy | 12% | 1D conv on imbalance series |

## Data scale

- **1500** 1m klines (paginated Binance)
- LOB history ring (48 snapshots)
- Dual depth Binance + Bybit

## Commands

```bash
npm run agent:mega-backtest   # 1200 bars
npm run agent:mega-train        # batch train all models on history
npm run agent:start
```

## Strategies (11)

momentum, mean reversion, RSI, EMA, vol regime, Bollinger, MACD, order imbalance, funding fade, volume breakout, long/short extreme.
