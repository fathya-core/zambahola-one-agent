import { randomUUID } from "node:crypto";
import type { Decision, DecisionAction, Prediction } from "../types.js";
import { isLearnTradeMode } from "../prediction-engine/learn-trade.js";
import {
  pickEntryAction,
  resolveTradeDirection,
  tradeThreshold,
} from "./learn-trade-decide.js";

export interface PositionState {
  side: "long" | "short" | null;
}

export class DecisionEngine {
  decide(prediction: Prediction, position: PositionState): Decision {
    const { meta } = prediction;
    const regime = meta?.regime ?? "range";
    const agreement = meta?.agreement ?? 0;
    const resolved = resolveTradeDirection(prediction);
    const { direction, confidence, fromLean } = resolved;

    let threshold = tradeThreshold(regime, meta?.mlSamples ?? 0);
    if (!isLearnTradeMode() && agreement >= 0.7) threshold = Math.min(threshold, 0.54);

    let action: DecisionAction = "no_trade";
    let reason = `Below threshold ${threshold} or range`;

    const closeThreshold = isLearnTradeMode()
      ? Number(process.env.ZAMBAHOLA_CLOSE_THRESHOLD ?? 0.4)
      : threshold;

    if (position.side === "long") {
      if (direction === "down" && confidence >= closeThreshold) {
        action = "paper_close";
        reason = "Close long — bearish hybrid signal";
      } else if (isLearnTradeMode() && direction === "range") {
        action = "no_trade";
        reason = "Hold long (learn)";
      } else {
        action = "no_trade";
        reason = "Hold long";
      }
    } else if (position.side === "short") {
      if (direction === "up" && confidence >= closeThreshold) {
        action = "paper_close";
        reason = "Close short — bullish hybrid signal";
      } else if (isLearnTradeMode() && direction === "range") {
        action = "no_trade";
        reason = "Hold short (learn)";
      } else {
        action = "no_trade";
        reason = "Hold short";
      }
    } else {
      const entry = pickEntryAction(
        direction,
        confidence,
        threshold,
        regime,
        null,
        meta?.engine,
      );
      if (entry) {
        action = entry.action;
        reason = entry.reason + (fromLean ? " · lean" : "");
      } else if (direction === "range") {
        action = "no_trade";
        reason = isLearnTradeMode() ? "Range — no lean for entry" : "Range — stay flat";
      } else if (meta?.gateReason?.includes("blocked") && !isLearnTradeMode()) {
        action = "no_trade";
        reason = meta.gateReason;
      }
    }

    return {
      decisionId: `dec-${randomUUID()}`,
      tickId: prediction.tickId,
      predictionId: prediction.predictionId,
      action,
      reason,
      timestamp: Date.now(),
    };
  }
}
