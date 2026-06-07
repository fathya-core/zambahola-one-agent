import type { PredictionDirection } from "../types.js";
import type { StrategySignal } from "./strategies/types.js";
import type { StrategyWeights } from "../learning/adaptive-weights.js";
import { getAccuracyTuning } from "../config/accuracy-profile.js";

const DIR_SCORE: Record<PredictionDirection, number> = {
  up: 1,
  down: -1,
  range: 0,
};

export interface EnsembleResult {
  direction: PredictionDirection;
  confidence: number;
  votes: StrategySignal[];
  agreement: number;
}

export function ensemblePredict(
  signals: StrategySignal[],
  weights: StrategyWeights,
): EnsembleResult {
  let score = 0;
  let weightSum = 0;
  let rangeVotes = 0;

  for (const s of signals) {
    const w = weights[s.strategyId] ?? 1;
    weightSum += w;
    score += DIR_SCORE[s.direction] * w * s.confidence;
    if (s.direction === "range") rangeVotes += w;
  }

  const normalized = weightSum > 0 ? score / weightSum : 0;

  const normThr = getAccuracyTuning().ensembleNorm;
  let direction: PredictionDirection = "range";
  if (normalized > normThr) direction = "up";
  else if (normalized < -normThr) direction = "down";

  const agreement = computeDirectionalAgreement(signals, direction);

  const confidence = Number(
    Math.min(0.95, Math.max(0.42, 0.45 + Math.abs(normalized) * 0.9 + agreement * 0.15)).toFixed(4),
  );

  return {
    direction,
    confidence,
    votes: signals,
    agreement: Number(agreement.toFixed(4)),
  };
}

/** Fraction of directional voters agreeing with final up/down (excludes range inflation) */
export function computeDirectionalAgreement(
  signals: StrategySignal[],
  direction: PredictionDirection,
): number {
  if (signals.length === 0) return 0;
  if (direction === "range") {
    return signals.filter((s) => s.direction === "range").length / signals.length;
  }
  const directional = signals.filter((s) => s.direction !== "range");
  if (directional.length === 0) return 0;
  return (
    directional.filter((s) => s.direction === direction).length / directional.length
  );
}

export function strategyHitsFromVotes(
  votes: StrategySignal[],
  actualDirection: PredictionDirection,
  priceChange: number,
  band: number,
): Record<string, boolean> {
  const hits: Record<string, boolean> = {};
  for (const v of votes) {
    hits[v.strategyId] = directionHit(v.direction, actualDirection, priceChange, band);
  }
  return hits;
}

function directionHit(
  predicted: PredictionDirection,
  _actual: PredictionDirection,
  change: number,
  band: number,
): boolean {
  if (predicted === "up") return change > band;
  if (predicted === "down") return change < -band;
  return Math.abs(change) <= band;
}
