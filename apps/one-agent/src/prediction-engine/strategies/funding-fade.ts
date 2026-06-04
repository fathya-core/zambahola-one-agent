import { getMarketSignals } from "../../market-signals/index.js";
import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

/** Fade crowded funding — contrarian microstructure signal */
export const fundingFadeStrategy: PredictionStrategy = {
  id: "funding_fade",
  name: "Funding fade",
  evaluate(_ctx: StrategyContext): StrategySignal {
    const s = getMarketSignals();
    if (Date.now() - s.updatedAt > 120_000) {
      return { strategyId: "funding_fade", direction: "range", confidence: 0.4, reason: "no funding data" };
    }
    if (s.fundingRate > 0.0001) {
      return {
        strategyId: "funding_fade",
        direction: "down",
        confidence: Math.min(0.85, 0.55 + s.fundingRate * 400),
        reason: "crowded longs pay funding",
      };
    }
    if (s.fundingRate < -0.00005) {
      return {
        strategyId: "funding_fade",
        direction: "up",
        confidence: Math.min(0.85, 0.55 + Math.abs(s.fundingRate) * 400),
        reason: "crowded shorts pay funding",
      };
    }
    return {
      strategyId: "funding_fade",
      direction: "range",
      confidence: 0.5,
      reason: "neutral funding",
    };
  },
};
