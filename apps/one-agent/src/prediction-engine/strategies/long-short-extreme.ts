import { getMarketSignals } from "../../market-signals/index.js";
import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

export const longShortExtremeStrategy: PredictionStrategy = {
  id: "long_short_extreme",
  name: "Long/short ratio extreme",
  evaluate(_ctx: StrategyContext): StrategySignal {
    const s = getMarketSignals();
    if (Date.now() - s.updatedAt > 120_000) {
      return {
        strategyId: "long_short_extreme",
        direction: "range",
        confidence: 0.4,
        reason: "no L/S data",
      };
    }
    if (s.longShortRatio > 1.35) {
      return {
        strategyId: "long_short_extreme",
        direction: "down",
        confidence: Math.min(0.88, 0.55 + (s.longShortRatio - 1) * 0.5),
        reason: `crowded longs L/S=${s.longShortRatio.toFixed(2)}`,
      };
    }
    if (s.longShortRatio < 0.75) {
      return {
        strategyId: "long_short_extreme",
        direction: "up",
        confidence: Math.min(0.88, 0.55 + (1 - s.longShortRatio) * 0.5),
        reason: `crowded shorts L/S=${s.longShortRatio.toFixed(2)}`,
      };
    }
    return {
      strategyId: "long_short_extreme",
      direction: "range",
      confidence: 0.5,
      reason: "balanced positioning",
    };
  },
};
