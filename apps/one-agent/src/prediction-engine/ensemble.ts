import type { PredictionDirection } from "../types.js";
import type { StrategySignal } from "./strategies/types.js";
import type { StrategyWeights } from "../learning/adaptive-weights.js";

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
  const agreement =
    signals.length > 0
      ? signals.filter((s) => s.direction === pickDirection(normalized, rangeVotes, weightSum))
          .length / signals.length
      : 0;

  let direction: PredictionDirection = "range";
  if (normalized > 0.12) direction = "up";
  else if (normalized < -0.12) direction = "down";

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

function pickDirection(
  normalized: number,
  rangeVotes: number,
  weightSum: number,
): PredictionDirection {
  if (rangeVotes / weightSum > 0.55) return "range";
  if (normalized > 0.12) return "up";
  if (normalized < -0.12) return "down";
  return "range";
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
