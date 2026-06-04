import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

function ema(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let v = prices[prices.length - period]!;
  for (let i = prices.length - period + 1; i < prices.length; i++) {
    v = prices[i]! * k + v * (1 - k);
  }
  return v;
}

export const emaCrossStrategy: PredictionStrategy = {
  id: "ema_cross",
  name: "EMA 5/13 cross",
  evaluate(ctx: StrategyContext): StrategySignal {
    const fast = ema(ctx.prices, 5);
    const slow = ema(ctx.prices, 13);
    if (fast == null || slow == null) {
      return { strategyId: "ema_cross", direction: "range", confidence: 0.4, reason: "warming up" };
    }
    const spread = (fast - slow) / slow;
    if (spread > 0.00025) {
      return {
        strategyId: "ema_cross",
        direction: "up",
        confidence: Math.min(0.88, 0.52 + spread * 400),
        reason: "fast EMA above slow",
      };
    }
    if (spread < -0.00025) {
      return {
        strategyId: "ema_cross",
        direction: "down",
        confidence: Math.min(0.88, 0.52 + Math.abs(spread) * 400),
        reason: "fast EMA below slow",
      };
    }
    return {
      strategyId: "ema_cross",
      direction: "range",
      confidence: 0.5,
      reason: "EMAs converged",
    };
  },
};
