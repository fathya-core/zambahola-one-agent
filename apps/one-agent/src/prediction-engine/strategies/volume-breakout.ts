import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

export const volumeBreakoutStrategy: PredictionStrategy = {
  id: "volume_breakout",
  name: "Volume breakout",
  evaluate(ctx: StrategyContext): StrategySignal {
    const v = ctx.volumes ?? [];
    if (v.length < 8 || ctx.prices.length < 8) {
      return { strategyId: "volume_breakout", direction: "range", confidence: 0.4, reason: "warming up" };
    }
    const avg = v.slice(-8, -1).reduce((a, b) => a + b, 0) / 7;
    const last = v[v.length - 1]!;
    const priceChg = ctx.currentPrice - ctx.prices[ctx.prices.length - 2]!;
    if (last > avg * 1.4 && priceChg > 0) {
      return {
        strategyId: "volume_breakout",
        direction: "up",
        confidence: 0.72,
        reason: "volume spike up",
      };
    }
    if (last > avg * 1.4 && priceChg < 0) {
      return {
        strategyId: "volume_breakout",
        direction: "down",
        confidence: 0.72,
        reason: "volume spike down",
      };
    }
    return {
      strategyId: "volume_breakout",
      direction: "range",
      confidence: 0.48,
      reason: "normal volume",
    };
  },
};
