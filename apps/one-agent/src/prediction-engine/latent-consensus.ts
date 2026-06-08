import type { PredictionDirection } from "../types.js";
import type { StrategyWeights } from "../learning/adaptive-weights.js";
import type { StrategySignal } from "./strategies/types.js";
import { computeDirectionalAgreement } from "./ensemble.js";
import type { StrategyTiers } from "./expert-consensus.js";

export interface LatentDirectionalSkew {
  candidate: PredictionDirection | null;
  sTierUp: number;
  sTierDown: number;
  directionalAgreement: number;
  upScore: number;
  downScore: number;
  promoted: boolean;
}

function sTierIds(tiers: StrategyTiers): Set<string> {
  return new Set([...(tiers.S_trend ?? []), ...(tiers.S_micro ?? [])]);
}

/**
 * When ensemble collapses to range, detect strong S-tier up/down skew
 * (e.g. 6 micro/trend votes up while mean_reversion pulls range).
 */
export function computeLatentDirectionalSkew(
  votes: StrategySignal[],
  weights: StrategyWeights,
  tiers: StrategyTiers,
): LatentDirectionalSkew {
  const sIds = sTierIds(tiers);
  let sTierUp = 0;
  let sTierDown = 0;
  let upScore = 0;
  let downScore = 0;

  for (const v of votes) {
    const w = weights[v.strategyId] ?? 1;
    if (v.direction === "up") upScore += w * v.confidence;
    else if (v.direction === "down") downScore += w * v.confidence;
    if (!sIds.has(v.strategyId)) continue;
    if (v.direction === "up") sTierUp += 1;
    else if (v.direction === "down") sTierDown += 1;
  }

  const minS = Number(process.env.ZAMBAHOLA_LATENT_MIN_S_VOTES ?? 2);
  const minWeightedMargin = Number(process.env.ZAMBAHOLA_LATENT_MIN_MARGIN ?? 0.12);

  let candidate: PredictionDirection | null = null;
  if (sTierUp >= minS && sTierUp >= sTierDown + 1) candidate = "up";
  else if (sTierDown >= minS && sTierDown >= sTierUp + 1) candidate = "down";

  const total = upScore + downScore;
  if (!candidate && total > 0) {
    const margin = Math.abs(upScore - downScore) / total;
    if (margin >= minWeightedMargin) {
      candidate = upScore > downScore ? "up" : "down";
    }
  }

  const directionalAgreement =
    candidate && candidate !== "range"
      ? computeDirectionalAgreement(votes, candidate)
      : 0;

  return {
    candidate,
    sTierUp,
    sTierDown,
    directionalAgreement,
    upScore: Number(upScore.toFixed(4)),
    downScore: Number(downScore.toFixed(4)),
    promoted: false,
  };
}

export function countSTierForDirection(
  votes: StrategySignal[],
  direction: PredictionDirection,
  tiers: StrategyTiers,
): number {
  if (direction === "range") return 0;
  const sIds = sTierIds(tiers);
  return votes.filter(
    (v) => v.direction === direction && sIds.has(v.strategyId),
  ).length;
}

export function shouldPromoteLatentDirection(
  ensembleDirection: PredictionDirection,
  latent: LatentDirectionalSkew,
): boolean {
  if (ensembleDirection !== "range" || !latent.candidate) return false;
  const minAgree = Number(process.env.ZAMBAHOLA_LATENT_MIN_AGREEMENT ?? 0.5);
  const minS = Number(process.env.ZAMBAHOLA_LATENT_MIN_S_VOTES ?? 2);
  const sCount =
    latent.candidate === "up" ? latent.sTierUp : latent.sTierDown;
  return sCount >= minS && latent.directionalAgreement >= minAgree;
}
