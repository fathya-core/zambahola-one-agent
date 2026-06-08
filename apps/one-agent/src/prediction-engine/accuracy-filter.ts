import type { PredictionDirection } from "../types.js";
import {
  getAccuracyTuning,
  isMaxAccuracy,
  isAccuracyFilterActive,
} from "../config/accuracy-profile.js";

export interface AccuracyFilterInput {
  direction: PredictionDirection;
  confidence: number;
  agreement: number;
  directionalAgreement?: number;
  mlProb: number;
  mlpProb: number;
  gbmProb: number;
  lobReady: boolean;
  regime: string;
  blocked: boolean;
  mlSamples: number;
  latentSTierVotes?: number;
}

export interface AccuracyFilterResult {
  direction: PredictionDirection;
  confidence: number;
  qualityTier: "high" | "medium" | "abstain";
  filterReason: string;
}

export function applyAccuracyFilter(input: AccuracyFilterInput): AccuracyFilterResult {
  if (!isAccuracyFilterActive()) {
    return {
      direction: input.direction,
      confidence: input.confidence,
      qualityTier: input.confidence >= 0.62 ? "high" : "medium",
      filterReason: "normal_mode",
    };
  }

  const t = getAccuracyTuning();
  let { direction, confidence, agreement } = input;
  let reason = "max_pass";

  const warmed = input.mlSamples >= 80;
  const minAgreement = warmed ? t.minAgreement : Math.min(t.minAgreement, 0.52);
  const sTier = input.latentSTierVotes ?? 0;
  const dirAgree = input.directionalAgreement ?? agreement;
  const minVoters =
    sTier >= 2
      ? Math.max(1, (warmed ? t.minModelVoters : 2) - 1)
      : warmed
        ? t.minModelVoters
        : 2;
  const agreeFloor =
    sTier >= 2 ? Math.max(0.5, minAgreement - 0.04) : minAgreement;

  const modelVotes = countModelAgreement(
    direction,
    input.mlProb,
    input.mlpProb,
    input.gbmProb,
  );

  const sTierFastPath =
    direction !== "range" && sTier >= 2 && dirAgree >= 0.5 && modelVotes >= 1;

  if (input.blocked && !sTierFastPath) {
    return abstain("gate_blocked");
  }

  if (direction !== "range") {
    const agreeUse = sTier >= 2 ? dirAgree : agreement;
    const agreeMin = sTier >= 2 ? agreeFloor : minAgreement;
    if (agreeUse < agreeMin) {
      return abstain(`agreement_${agreeUse}_lt_${agreeMin}`);
    }
    if (modelVotes < minVoters) {
      return abstain(`model_voters_${modelVotes}`);
    }
    if (confidence < 0.56) {
      return abstain("low_confidence");
    }
    if (input.regime === "high_vol" && confidence < 0.68) {
      return abstain("high_vol_need_higher_conf");
    }
  }

  if (direction === "range") {
    confidence = Math.min(confidence, 0.52);
    reason = "range_abstain";
  } else if (agreement >= 0.72 && modelVotes >= 4 && confidence >= 0.6) {
    confidence = Math.min(0.96, confidence + 0.04);
    reason = "high_consensus_boost";
  }

  const qualityTier: AccuracyFilterResult["qualityTier"] =
    direction === "range"
      ? "abstain"
      : agreement >= 0.65 && confidence >= 0.6
        ? "high"
        : "medium";

  return {
    direction,
    confidence: Number(confidence.toFixed(4)),
    qualityTier,
    filterReason: reason,
  };

  function abstain(r: string): AccuracyFilterResult {
    return {
      direction: "range",
      confidence: 0.48,
      qualityTier: "abstain",
      filterReason: r,
    };
  }
}

function countModelAgreement(
  direction: PredictionDirection,
  ml: number,
  mlp: number,
  gbm: number,
): number {
  if (direction === "range") return 0;
  let n = 0;
  const agrees = (prob: number) =>
    direction === "up" ? prob > 0.55 : prob < 0.45;
  if (agrees(ml)) n += 1;
  if (agrees(mlp)) n += 1;
  if (agrees(gbm)) n += 1;
  return n;
}
