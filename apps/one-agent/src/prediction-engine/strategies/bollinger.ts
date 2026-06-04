import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

export const bollingerStrategy: PredictionStrategy = {
  id: "bollinger",
  name: "Bollinger band proxy",
  evaluate(ctx: StrategyContext): StrategySignal {
    const n = Math.min(20, ctx.prices.length);
    if (n < 8) {
      return { strategyId: "bollinger", direction: "range", confidence: 0.4, reason: "warming up" };
    }
    const slice = ctx.prices.slice(-n);
    const mean = slice.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(
      slice.reduce((s, p) => s + (p - mean) ** 2, 0) / n,
    );
    const upper = mean + 2 * std;
    const lower = mean - 2 * std;
    const p = ctx.currentPrice;

    if (p >= upper) {
      return {
        strategyId: "bollinger",
        direction: "down",
        confidence: Math.min(0.86, 0.55 + (p - upper) / mean),
        reason: "at/above upper band",
      };
    }
    if (p <= lower) {
      return {
        strategyId: "bollinger",
        direction: "up",
        confidence: Math.min(0.86, 0.55 + (lower - p) / mean),
        reason: "at/below lower band",
      };
    }
    return {
      strategyId: "bollinger",
      direction: "range",
      confidence: 0.52,
      reason: "inside bands",
    };
  },
};
