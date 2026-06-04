# v0.3 — Maximum Power

## New

| Feature | Description |
|---------|-------------|
| **Universal feed** | Binance hybrid + order book depth + Bybit failover |
| **8 strategies** | + MACD + order book imbalance |
| **13 ML features** | book imbalance, spread, MACD hist |
| **hybrid_v3** | ensemble + ML + regime + sentiment |
| **Backtest** | `npm run agent:backtest` on 120×1m candles |
| **power-learn** | 10 cycles × 65s training |

## Default feed

`ZAMBAHOLA_FEED=universal` (default)

## Commands

```bash
npm run agent:start
npm run agent:power-learn
npm run agent:backtest
```
