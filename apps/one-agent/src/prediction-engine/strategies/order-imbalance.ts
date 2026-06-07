import { getOrderBook } from "../../market-feed/orderbook.js";
import type { PredictionStrategy, StrategyContext, StrategySignal } from "./types.js";

export const orderImbalanceStrategy: PredictionStrategy = {
  id: "order_imbalance",
  name: "Order book imbalance",
  evaluate(_ctx: StrategyContext): StrategySignal {
    const book = getOrderBook();
    if (!book || Date.now() - book.updatedAt > 10_000) {
      return {
        strategyId: "order_imbalance",
        direction: "range",
        confidence: 0.4,
        reason: "no fresh book",
      };
    }
    const imb = book.imbalance5 ?? book.imbalance;
    const thr = Number(process.env.ZAMBAHOLA_IMB_THRESHOLD ?? 0.12);
    if (imb > thr) {
      return {
        strategyId: "order_imbalance",
        direction: "up",
        confidence: Math.min(0.88, 0.55 + imb),
        reason: `bid pressure ${(imb * 100).toFixed(1)}%`,
      };
    }
    if (imb < -thr) {
      return {
        strategyId: "order_imbalance",
        direction: "down",
        confidence: Math.min(0.88, 0.55 + Math.abs(imb)),
        reason: `ask pressure ${(imb * 100).toFixed(1)}%`,
      };
    }
    return {
      strategyId: "order_imbalance",
      direction: "range",
      confidence: 0.52,
      reason: `balanced book spread ${book.spreadBps.toFixed(1)}bps`,
    };
  },
};
