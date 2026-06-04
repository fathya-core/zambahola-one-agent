import { getMarketSignals } from "../../market-signals/index.js";
import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

export const openInterestStrategy: PredictionStrategy = {
  id: "open_interest",
  name: "Open interest bias",
  evaluate(ctx: StrategyContext): StrategySignal {
    const s = getMarketSignals();
    const oi = s.openInterestChange;
    if (oi == null || Date.now() - s.updatedAt > 120_000) {
      return { strategyId: "open_interest", direction: "range", confidence: 0.4, reason: "no OI" };
    }
    const mom = ctx.currentPrice - (ctx.prices[ctx.prices.length - 5] ?? ctx.currentPrice);
    if (oi > 0.02 && mom > 0) {
      return {
        strategyId: "open_interest",
        direction: "up",
        confidence: 0.68,
        reason: "OI rising + price up",
      };
    }
    if (oi > 0.02 && mom < 0) {
      return {
        strategyId: "open_interest",
        direction: "down",
        confidence: 0.65,
        reason: "OI rising + price down (shorts)",
      };
    }
    return { strategyId: "open_interest", direction: "range", confidence: 0.5, reason: "OI flat" };
  },
};
