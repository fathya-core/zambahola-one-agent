import type { PredictionDirection, StrategyVoteMeta } from "../types.js";
import { isLearnTradeActive } from "../config/hybrid-mode.js";

export function isLearnTradeMode(): boolean {
  return isLearnTradeActive();
}

/** When ensemble says range, pick up/down from strategy vote skew for paper learning */
export function inferLeanFromVotes(
  votes: StrategyVoteMeta[],
): { direction: PredictionDirection; confidence: number } | null {
  let upScore = 0;
  let downScore = 0;

  for (const v of votes) {
    if (v.direction === "up") upScore += v.confidence;
    else if (v.direction === "down") downScore += v.confidence;
  }

  const minLean = Number(process.env.ZAMBAHOLA_LEAN_MIN_SCORE ?? 2.2);
  const minMargin = Number(process.env.ZAMBAHOLA_LEAN_MIN_MARGIN ?? 0.6);
  const margin = upScore - downScore;

  if (margin >= minMargin && upScore >= minLean) {
    return {
      direction: "up",
      confidence: Number(
        Math.min(0.75, 0.44 + margin * 0.06 + upScore * 0.02).toFixed(4),
      ),
    };
  }
  if (-margin >= minMargin && downScore >= minLean) {
    return {
      direction: "down",
      confidence: Number(
        Math.min(0.75, 0.44 + -margin * 0.06 + downScore * 0.02).toFixed(4),
      ),
    };
  }
  return null;
}
