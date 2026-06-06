import type { DecisionAction, Prediction, PredictionDirection } from "../types.js";
import { inferLeanFromVotes, isLearnTradeMode } from "../prediction-engine/learn-trade.js";

export function resolveTradeDirection(prediction: Prediction): {
  direction: PredictionDirection;
  confidence: number;
  fromLean: boolean;
} {
  const { direction, confidence, meta } = prediction;
  if (!isLearnTradeMode() || direction !== "range" || !meta?.strategyVotes?.length) {
    return { direction, confidence, fromLean: false };
  }
  const lean = inferLeanFromVotes(meta.strategyVotes);
  if (!lean) return { direction, confidence, fromLean: false };
  return { direction: lean.direction, confidence: lean.confidence, fromLean: true };
}

export function tradeThreshold(regime: string, mlSamples: number): number {
  if (!isLearnTradeMode()) {
    let threshold = 0.58;
    if (regime === "high_vol") threshold = 0.64;
    if (regime === "range") threshold = 0.62;
    if (mlSamples > 40) threshold -= 0.02;
    return threshold;
  }

  let threshold = Number(process.env.ZAMBAHOLA_TRADE_THRESHOLD ?? 0.42);
  if (regime === "range") threshold = Math.min(threshold, 0.45);
  if (regime === "high_vol") threshold += 0.06;
  return threshold;
}

export function pickEntryAction(
  direction: PredictionDirection,
  confidence: number,
  threshold: number,
  regime: string,
  positionSide: "long" | "short" | null,
  engine = "hybrid",
): { action: DecisionAction; reason: string } | null {
  if (positionSide) return null;

  if (direction === "up" && confidence >= threshold && regime !== "trend_down") {
    const prefix = isLearnTradeMode() ? "Learn-trade" : `Hybrid [${engine}]`;
    return {
      action: "paper_long",
      reason: `${prefix} long conf=${confidence.toFixed(2)} regime=${regime}`,
    };
  }
  if (direction === "down" && confidence >= threshold && regime !== "trend_up") {
    const prefix = isLearnTradeMode() ? "Learn-trade" : `Hybrid [${engine}]`;
    return {
      action: "paper_short",
      reason: `${prefix} short conf=${confidence.toFixed(2)} regime=${regime}`,
    };
  }
  return null;
}
