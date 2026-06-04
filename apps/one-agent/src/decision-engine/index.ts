import { randomUUID } from "node:crypto";
import type { Decision, DecisionAction, Prediction } from "../types.js";

export interface PositionState {
  side: "long" | "short" | null;
}

export class DecisionEngine {
  decide(prediction: Prediction, position: PositionState): Decision {
    const { direction, confidence, meta } = prediction;
    const regime = meta?.regime ?? "range";
    const agreement = meta?.agreement ?? 0;

    let threshold = 0.58;
    if (agreement >= 0.7) threshold = 0.54;
    if (regime === "high_vol") threshold = 0.64;
    if (regime === "range") threshold = 0.62;
    if ((meta?.mlSamples ?? 0) > 40) threshold -= 0.02;

    let action: DecisionAction = "no_trade";
    let reason = `Below threshold ${threshold} or range`;

    if (position.side === "long") {
      if (direction === "down" && confidence >= threshold) {
        action = "paper_close";
        reason = "Close long — bearish hybrid signal";
      } else {
        action = "no_trade";
        reason = "Hold long";
      }
    } else if (position.side === "short") {
      if (direction === "up" && confidence >= threshold) {
        action = "paper_close";
        reason = "Close short — bullish hybrid signal";
      } else {
        action = "no_trade";
        reason = "Hold short";
      }
    } else if (direction === "up" && confidence >= threshold && regime !== "trend_down") {
      action = "paper_long";
      reason = `Hybrid long [${meta?.engine}] regime=${regime}`;
    } else if (direction === "down" && confidence >= threshold && regime !== "trend_up") {
      action = "paper_short";
      reason = `Hybrid short [${meta?.engine}] regime=${regime}`;
    } else if (direction === "range") {
      action = "no_trade";
      reason = "Range — stay flat";
    } else if (meta?.gateReason?.includes("blocked")) {
      action = "no_trade";
      reason = meta.gateReason;
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
