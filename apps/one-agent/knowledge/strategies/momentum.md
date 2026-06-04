# Momentum strategy

**Source concepts:** Murphy — trend continuation; Chan — short-term momentum factors.

**Logic:** Compare current price to price N ticks ago. Positive drift → `up`, negative → `down`, else `range`.

**Improve accuracy:** Tune `LOOKBACK` and threshold per symbol volatility; disable in low-vol regimes.
