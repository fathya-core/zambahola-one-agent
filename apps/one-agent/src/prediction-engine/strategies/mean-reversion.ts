import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

export const meanReversionStrategy: PredictionStrategy = {
  id: "mean_reversion",
  name: "Mean reversion (SMA)",
  evaluate(ctx: StrategyContext): StrategySignal {
    const n = Math.min(20, ctx.prices.length);
    if (n < 5) {
      return { strategyId: "mean_reversion", direction: "range", confidence: 0.4, reason: "warming up" };
    }
    const slice = ctx.prices.slice(-n);
    const sma = slice.reduce((a, b) => a + b, 0) / n;
    const z = (ctx.currentPrice - sma) / sma;
    if (z > 0.0012) {
      return {
        strategyId: "mean_reversion",
        direction: "down",
        confidence: Math.min(0.88, 0.5 + z * 120),
        reason: "price above SMA — expect pullback",
      };
    }
    if (z < -0.0012) {
      return {
        strategyId: "mean_reversion",
        direction: "up",
        confidence: Math.min(0.88, 0.5 + Math.abs(z) * 120),
        reason: "price below SMA — expect bounce",
      };
    }
    return {
      strategyId: "mean_reversion",
      direction: "range",
      confidence: 0.5,
      reason: "near SMA",
    };
  },
};
