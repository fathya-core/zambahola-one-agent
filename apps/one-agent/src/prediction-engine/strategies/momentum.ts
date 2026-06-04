import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

const LOOKBACK = 8;
const THRESHOLD_PCT = 0.00035;

export const momentumStrategy: PredictionStrategy = {
  id: "momentum",
  name: "Momentum (N-tick)",
  evaluate(ctx: StrategyContext): StrategySignal {
    if (ctx.prices.length < LOOKBACK) {
      return { strategyId: "momentum", direction: "range", confidence: 0.4, reason: "warming up" };
    }
    const oldest = ctx.prices[ctx.prices.length - LOOKBACK]!;
    const change = (ctx.currentPrice - oldest) / oldest;
    if (change > THRESHOLD_PCT) {
      return {
        strategyId: "momentum",
        direction: "up",
        confidence: Math.min(0.92, 0.55 + change * 800),
        reason: `+${(change * 100).toFixed(3)}% over ${LOOKBACK} ticks`,
      };
    }
    if (change < -THRESHOLD_PCT) {
      return {
        strategyId: "momentum",
        direction: "down",
        confidence: Math.min(0.92, 0.55 + Math.abs(change) * 800),
        reason: `${(change * 100).toFixed(3)}% over ${LOOKBACK} ticks`,
      };
    }
    return {
      strategyId: "momentum",
      direction: "range",
      confidence: 0.52,
      reason: "flat momentum",
    };
  },
};
