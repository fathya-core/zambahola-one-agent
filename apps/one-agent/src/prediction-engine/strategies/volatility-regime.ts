import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

export const volatilityRegimeStrategy: PredictionStrategy = {
  id: "volatility_regime",
  name: "Volatility regime",
  evaluate(ctx: StrategyContext): StrategySignal {
    const n = Math.min(15, ctx.prices.length);
    if (n < 6) {
      return { strategyId: "volatility_regime", direction: "range", confidence: 0.4, reason: "warming up" };
    }
    const slice = ctx.prices.slice(-n);
    const returns: number[] = [];
    for (let i = 1; i < slice.length; i++) {
      returns.push((slice[i]! - slice[i - 1]!) / slice[i - 1]!);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const vol = Math.sqrt(variance);
    const lastRet = returns[returns.length - 1] ?? 0;

    if (vol < 0.00015) {
      return {
        strategyId: "volatility_regime",
        direction: "range",
        confidence: 0.62,
        reason: "low vol — range regime",
      };
    }
    if (lastRet > vol * 1.2) {
      return {
        strategyId: "volatility_regime",
        direction: "up",
        confidence: Math.min(0.85, 0.55 + lastRet * 200),
        reason: "high vol breakout up",
      };
    }
    if (lastRet < -vol * 1.2) {
      return {
        strategyId: "volatility_regime",
        direction: "down",
        confidence: Math.min(0.85, 0.55 + Math.abs(lastRet) * 200),
        reason: "high vol breakout down",
      };
    }
    return {
      strategyId: "volatility_regime",
      direction: "range",
      confidence: 0.5,
      reason: "mixed vol",
    };
  },
};
