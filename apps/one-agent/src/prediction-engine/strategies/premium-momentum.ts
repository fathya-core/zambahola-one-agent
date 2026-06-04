import { getMarketSignals } from "../../market-signals/index.js";
import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

export const premiumMomentumStrategy: PredictionStrategy = {
  id: "premium_momentum",
  name: "Perp premium momentum",
  evaluate(ctx: StrategyContext): StrategySignal {
    const s = getMarketSignals();
    if (Date.now() - s.updatedAt > 120_000) {
      return { strategyId: "premium_momentum", direction: "range", confidence: 0.4, reason: "no premium" };
    }
    const prem = s.premiumPct;
    const mom =
      ctx.prices.length >= 3
        ? ctx.currentPrice - ctx.prices[ctx.prices.length - 3]!
        : 0;
    if (prem > 0.02 && mom > 0) {
      return {
        strategyId: "premium_momentum",
        direction: "up",
        confidence: 0.7,
        reason: "premium+price aligned up",
      };
    }
    if (prem < -0.02 && mom < 0) {
      return {
        strategyId: "premium_momentum",
        direction: "down",
        confidence: 0.7,
        reason: "discount+price aligned down",
      };
    }
    return { strategyId: "premium_momentum", direction: "range", confidence: 0.48, reason: "mixed premium" };
  },
};
