import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

/** Ultra short tick momentum (last 3 prices) */
export const tickMomentumStrategy: PredictionStrategy = {
  id: "tick_momentum",
  name: "Tick momentum",
  evaluate(ctx: StrategyContext): StrategySignal {
    if (ctx.prices.length < 4) {
      return { strategyId: "tick_momentum", direction: "range", confidence: 0.4, reason: "warming up" };
    }
    const p0 = ctx.prices[ctx.prices.length - 1]!;
    const p1 = ctx.prices[ctx.prices.length - 2]!;
    const p2 = ctx.prices[ctx.prices.length - 3]!;
    const d1 = p0 - p1;
    const d2 = p1 - p2;
    if (d1 > 0 && d2 > 0) {
      return {
        strategyId: "tick_momentum",
        direction: "up",
        confidence: Math.min(0.82, 0.55 + (d1 + d2) / p0 * 500),
        reason: "3-tick up streak",
      };
    }
    if (d1 < 0 && d2 < 0) {
      return {
        strategyId: "tick_momentum",
        direction: "down",
        confidence: Math.min(0.82, 0.55 + Math.abs(d1 + d2) / p0 * 500),
        reason: "3-tick down streak",
      };
    }
    return { strategyId: "tick_momentum", direction: "range", confidence: 0.48, reason: "choppy ticks" };
  },
};
