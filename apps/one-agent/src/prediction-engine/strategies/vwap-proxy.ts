import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

export const vwapProxyStrategy: PredictionStrategy = {
  id: "vwap_proxy",
  name: "VWAP proxy",
  evaluate(ctx: StrategyContext): StrategySignal {
    const prices = ctx.prices;
    const vols = ctx.volumes;
    if (prices.length < 10 || vols.length < 10) {
      return { strategyId: "vwap_proxy", direction: "range", confidence: 0.4, reason: "warming up" };
    }
    let pv = 0;
    let v = 0;
    const n = Math.min(20, prices.length);
    for (let i = prices.length - n; i < prices.length; i++) {
      const vol = vols[i] ?? 1;
      pv += prices[i]! * vol;
      v += vol;
    }
    const vwap = pv / (v || 1);
    const diff = (ctx.currentPrice - vwap) / vwap;
    if (diff > 0.0004) {
      return {
        strategyId: "vwap_proxy",
        direction: "up",
        confidence: Math.min(0.86, 0.52 + diff * 200),
        reason: "above VWAP proxy",
      };
    }
    if (diff < -0.0004) {
      return {
        strategyId: "vwap_proxy",
        direction: "down",
        confidence: Math.min(0.86, 0.52 + Math.abs(diff) * 200),
        reason: "below VWAP proxy",
      };
    }
    return { strategyId: "vwap_proxy", direction: "range", confidence: 0.5, reason: "at VWAP" };
  },
};
