import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

/** UTC session biases (simplified) */
export const sessionBiasStrategy: PredictionStrategy = {
  id: "session_bias",
  name: "Session bias",
  evaluate(ctx: StrategyContext): StrategySignal {
    const h = new Date().getUTCHours();
    const mom =
      ctx.prices.length >= 6
        ? (ctx.currentPrice - ctx.prices[ctx.prices.length - 6]!) / ctx.prices[ctx.prices.length - 6]!
        : 0;
    if (h >= 13 && h <= 21 && mom > 0.0002) {
      return {
        strategyId: "session_bias",
        direction: "up",
        confidence: 0.62,
        reason: "US session momentum up",
      };
    }
    if (h >= 0 && h <= 8 && mom < -0.0002) {
      return {
        strategyId: "session_bias",
        direction: "down",
        confidence: 0.6,
        reason: "Asia drift down",
      };
    }
    return { strategyId: "session_bias", direction: "range", confidence: 0.48, reason: "no session edge" };
  },
};
