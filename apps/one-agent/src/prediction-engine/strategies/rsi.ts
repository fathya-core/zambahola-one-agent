import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

function rsi(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const d = prices[i]! - prices[i - 1]!;
    if (d >= 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export const rsiStrategy: PredictionStrategy = {
  id: "rsi",
  name: "RSI oscillator",
  evaluate(ctx: StrategyContext): StrategySignal {
    const value = rsi(ctx.prices);
    if (value == null) {
      return { strategyId: "rsi", direction: "range", confidence: 0.4, reason: "warming up" };
    }
    if (value >= 68) {
      return {
        strategyId: "rsi",
        direction: "down",
        confidence: Math.min(0.9, 0.5 + (value - 68) / 80),
        reason: `RSI overbought ${value.toFixed(1)}`,
      };
    }
    if (value <= 32) {
      return {
        strategyId: "rsi",
        direction: "up",
        confidence: Math.min(0.9, 0.5 + (32 - value) / 80),
        reason: `RSI oversold ${value.toFixed(1)}`,
      };
    }
    return {
      strategyId: "rsi",
      direction: "range",
      confidence: 0.48,
      reason: `RSI neutral ${value.toFixed(1)}`,
    };
  },
};
