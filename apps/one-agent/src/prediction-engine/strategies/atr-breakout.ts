import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

function atr(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = prices.length - period; i < prices.length; i++) {
    const hi = prices[i]!;
    const lo = prices[i]!;
    const prev = prices[i - 1]!;
    trs.push(Math.max(hi - lo, Math.abs(hi - prev), Math.abs(lo - prev)));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

export const atrBreakoutStrategy: PredictionStrategy = {
  id: "atr_breakout",
  name: "ATR breakout",
  evaluate(ctx: StrategyContext): StrategySignal {
    if (ctx.prices.length < 16) {
      return { strategyId: "atr_breakout", direction: "range", confidence: 0.4, reason: "warming up" };
    }
    const a = atr(ctx.prices);
    const p = ctx.currentPrice;
    const prev = ctx.prices[ctx.prices.length - 2]!;
    const move = p - prev;
    if (move > a * 0.6) {
      return {
        strategyId: "atr_breakout",
        direction: "up",
        confidence: Math.min(0.88, 0.55 + move / (a * 4)),
        reason: "ATR breakout up",
      };
    }
    if (move < -a * 0.6) {
      return {
        strategyId: "atr_breakout",
        direction: "down",
        confidence: Math.min(0.88, 0.55 + Math.abs(move) / (a * 4)),
        reason: "ATR breakout down",
      };
    }
    return { strategyId: "atr_breakout", direction: "range", confidence: 0.5, reason: "inside ATR" };
  },
};
