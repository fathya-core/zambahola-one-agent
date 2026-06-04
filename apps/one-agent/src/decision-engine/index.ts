import { randomUUID } from "node:crypto";
import type { Decision, DecisionAction, Prediction } from "../types.js";

export interface PositionState {
  side: "long" | "short" | null;
}

const CONFIDENCE_TRADE_MIN = 0.58;

export class DecisionEngine {
  decide(
    prediction: Prediction,
    position: PositionState,
  ): Decision {
    let action: DecisionAction = "no_trade";
    let reason = "Low confidence or range signal";

    const { direction, confidence } = prediction;

    if (position.side === "long") {
      if (direction === "down" && confidence >= CONFIDENCE_TRADE_MIN) {
        action = "paper_close";
        reason = "Close long on bearish signal";
      } else {
        action = "no_trade";
        reason = "Hold long";
      }
    } else if (position.side === "short") {
      if (direction === "up" && confidence >= CONFIDENCE_TRADE_MIN) {
        action = "paper_close";
        reason = "Close short on bullish signal";
      } else {
        action = "no_trade";
        reason = "Hold short";
      }
    } else if (direction === "up" && confidence >= CONFIDENCE_TRADE_MIN) {
      action = "paper_long";
      reason = "Open paper long on bullish prediction";
    } else if (direction === "down" && confidence >= CONFIDENCE_TRADE_MIN) {
      action = "paper_short";
      reason = "Open paper short on bearish prediction";
    } else if (direction === "range") {
      action = "no_trade";
      reason = "Range prediction — stay flat";
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
