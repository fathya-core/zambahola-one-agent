# v0.4 DEEP — Maximum intelligence

## Architecture `hybrid_v4_deep`

```
Universal Feed + Dual Depth (Binance/Bybit)
Market Signals (funding, premium, long/short)
Sentiment (Fear/Greed + RSS)
        ↓
10 strategies (incl. funding fade, volume breakout)
        ↓
Ensemble (40%) + Logistic ML (30%) + MLP 16-8 (30%)
        ↓
Regime gate + Calibration
```

## 18 features

Price, vol, RSI, book, MACD, funding, premium, L/S ratio, volume, time cycle.

## Commands

```bash
npm run agent:start
npm run agent:deep-backtest    # 500 candles
npm run agent:deep-learn       # 15 cycles + backtest bookends
npm run agent:power-learn
```

## API

- `/api/signals` — funding & positioning
- `/api/orderbook`
- `/api/sentiment`
