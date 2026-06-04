# Deep research synthesis (v0.4)

Sources: arXiv Deep LOB (2024), DolphinDB HFT backtest practices, funding rate microstructure.

## Implemented from research

| Technique | Implementation |
|-----------|----------------|
| Order book imbalance | Binance + Bybit depth pollers |
| Funding / premium | `market-signals` Binance FAPI |
| Long/short ratio | Binance global L/S account ratio |
| Deep learning proxy | 2-layer MLP (18→16→8→1) online |
| Walk-forward data | 500×1m kline deep backtest |
| Volume spikes | `volume_breakout` strategy |
| Funding contrarian | `funding_fade` strategy |

## Not yet (v0.5+)

- Full LOB 500-level tensors + CNN-LSTM
- TCN on tick data
- LightGBM batch training pipeline

## References

- https://arxiv.org/html/2403.09267v3
- https://docs.dolphindb.com/en/Tutorials/market_making_strategies.html
