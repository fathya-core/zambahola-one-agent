import type { PredictionDirection } from "../types.js";
import type { StrategySignal } from "./strategies/types.js";
import type { MarketRegime } from "./regime-gate.js";

export type StrategyTiers = Record<string, string[]>;

const DEFAULT_TIERS: StrategyTiers = {
  S_trend: ["momentum", "ema_cross", "macd", "session_bias", "atr_breakout"],
  S_micro: ["order_imbalance", "premium_momentum", "funding_fade", "open_interest"],
  A_flow: ["volume_breakout", "vwap_proxy", "tick_momentum"],
  B_range: ["mean_reversion", "rsi", "bollinger"],
  C_context: ["volatility_regime", "long_short_extreme"],
};

export interface ExpertConsensusResult {
  direction: PredictionDirection;
  confidence: number;
  expertAgreement: number;
  tierSVotes: number;
  blocked: boolean;
  reason: string;
}

function minSTierVotes(agreement: number): number {
  const base = Number(process.env.ZAMBAHOLA_EXPERT_MIN_S_VOTES ?? 2);
  if (process.env.ZAMBAHOLA_EXPERT_RELAX === "1" && agreement >= 0.55) {
    return Math.min(base, 1);
  }
  return base;
}

export function applyExpertConsensus(
  direction: PredictionDirection,
  confidence: number,
  agreement: number,
  regime: MarketRegime,
  votes: StrategySignal[],
  tiers: StrategyTiers = DEFAULT_TIERS,
): ExpertConsensusResult {
  const sTrend = tiers.S_trend ?? [];
  const sMicro = tiers.S_micro ?? [];
  const bRange = tiers.B_range ?? [];

  const sVotes = votes.filter(
    (v) =>
      v.direction === direction &&
      direction !== "range" &&
      (sTrend.includes(v.strategyId) || sMicro.includes(v.strategyId)),
  ).length;

  const bVotes = votes.filter(
    (v) => v.direction === direction && bRange.includes(v.strategyId),
  ).length;

  let d = direction;
  let c = confidence;
  let blocked = false;
  let reason = "expert_pass";

  if (regime === "trend_up" || regime === "trend_down") {
    const counter = votes.filter(
      (v) =>
        v.strategyId === "mean_reversion" &&
        v.direction !== "range" &&
        v.direction !== direction,
    );
    if (counter.length > 0 && agreement < 0.7) {
      d = "range";
      c = 0.48;
      blocked = true;
      reason = "expert_block_counter_mean_rev_in_trend";
    } else if (direction !== "range" && sVotes < minSTierVotes(agreement)) {
      d = "range";
      c = 0.5;
      blocked = true;
      reason = "expert_need_S_tier_votes";
    }
  }

  if (regime === "range" && direction !== "range") {
    if (bVotes < 2 && agreement < 0.65) {
      d = "range";
      c = 0.48;
      blocked = true;
      reason = "expert_range_need_B_tier";
    }
  }

  if (regime === "high_vol" && direction !== "range") {
    c = Math.min(c, 0.66);
    if (sVotes < 2) {
      d = "range";
      blocked = true;
      reason = "expert_high_vol_need_S_tier";
    }
  }

  if (d !== "range" && sVotes >= 3 && agreement >= 0.68) {
    c = Math.min(0.94, c + 0.06);
    reason = "expert_S_tier_boost";
  }

  const expertAgreement = Number(
    (votes.filter((v) => v.direction === d).length / Math.max(1, votes.length)).toFixed(4),
  );

  return {
    direction: d,
    confidence: Number(c.toFixed(4)),
    expertAgreement,
    tierSVotes: sVotes,
    blocked,
    reason,
  };
}
