# v0.6 ULTRA

## 17 strategies

momentum, mean reversion, RSI, EMA, volatility, Bollinger, MACD, order imbalance, funding fade, volume breakout, long/short extreme, ATR breakout, VWAP proxy, premium momentum, open interest, session bias, tick momentum.

## Learning cycles (defaults)

| Command | Cycles | Extra |
|---------|--------|-------|
| `agent:learn` | **25** | 65s each |
| `agent:power-learn` | **20** | mock |
| `agent:deep-learn` | **25** | + backtest |
| `agent:ultra-learn` | **30** live + **5000** bar train | full pipeline |
| `agent:mega-train` | — | **3000** bars |

## Engine `hybrid_v6_ultra`

Same 5 layers as v5 + strategy orchestrator boosts top 8 performers each ultra cycle.

## Fast ticks

```bash
ZAMBAHOLA_FAST=1 npm run agent:start
# or ZAMBAHOLA_FEED=fast
ZAMBAHOLA_TICK_MS=400
```

## Ultra learn

```bash
npm run agent:ultra-learn
```

Pipeline: pre-backtest → mega-train 5000 bars → 30 live cycles → post-backtest → orchestrator weights.
