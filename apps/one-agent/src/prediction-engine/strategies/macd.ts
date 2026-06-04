import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

function emaSeries(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let v = prices[0]!;
  for (const p of prices) {
    v = p * k + v * (1 - k);
    out.push(v);
  }
  return out;
}

export const macdStrategy: PredictionStrategy = {
  id: "macd",
  name: "MACD signal",
  evaluate(ctx: StrategyContext): StrategySignal {
    if (ctx.prices.length < 26) {
      return { strategyId: "macd", direction: "range", confidence: 0.4, reason: "warming up" };
    }
    const ema12 = emaSeries(ctx.prices, 12);
    const ema26 = emaSeries(ctx.prices, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]!);
    const signal = emaSeries(macdLine.slice(-20), 9);
    const m = macdLine[macdLine.length - 1]!;
    const s = signal[signal.length - 1]!;
    const hist = m - s;

    if (hist > 0 && m > 0) {
      return {
        strategyId: "macd",
        direction: "up",
        confidence: Math.min(0.9, 0.55 + Math.abs(hist) / (ctx.currentPrice * 0.0001)),
        reason: `MACD bullish hist=${hist.toFixed(2)}`,
      };
    }
    if (hist < 0 && m < 0) {
      return {
        strategyId: "macd",
        direction: "down",
        confidence: Math.min(0.9, 0.55 + Math.abs(hist) / (ctx.currentPrice * 0.0001)),
        reason: `MACD bearish hist=${hist.toFixed(2)}`,
      };
    }
    return {
      strategyId: "macd",
      direction: "range",
      confidence: 0.5,
      reason: "MACD neutral",
    };
  },
};
