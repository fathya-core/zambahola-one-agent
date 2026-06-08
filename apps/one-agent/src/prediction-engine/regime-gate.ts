import type { PredictionDirection } from "../types.js";
import type { FeatureVector } from "../features/index.js";
import { getAccuracyTuning } from "../config/accuracy-profile.js";

export type MarketRegime = "trend_up" | "trend_down" | "range" | "high_vol";

export function detectRegime(f: FeatureVector): MarketRegime {
  if (f.volatility > 0.00045) {
    if (f.momentumNorm > 0.25) return "trend_up";
    if (f.momentumNorm < -0.25) return "trend_down";
    return "high_vol";
  }
  const rangeMom = Number(process.env.ZAMBAHOLA_RANGE_MOMENTUM_MAX ?? 0.12);
  const rangeZ = Number(process.env.ZAMBAHOLA_RANGE_ZSCORE_MAX ?? 0.5);
  if (Math.abs(f.momentumNorm) < rangeMom && Math.abs(f.zScore) < rangeZ) return "range";
  if (f.momentumNorm > 0.2) return "trend_up";
  if (f.momentumNorm < -0.2) return "trend_down";
  return "range";
}

export interface GatedSignal {
  direction: PredictionDirection;
  confidence: number;
  regime: MarketRegime;
  blocked: boolean;
  reason: string;
}

export function applyRegimeGate(
  direction: PredictionDirection,
  confidence: number,
  agreement: number,
  regime: MarketRegime,
  sentiment: number,
  opts?: { directionalAgreement?: number; latentSTierVotes?: number },
): GatedSignal {
  let d = direction;
  let c = confidence;
  let blocked = false;
  let reason = "passed";

  const t = getAccuracyTuning();
  const dirAgree = opts?.directionalAgreement ?? agreement;
  const sTier = opts?.latentSTierVotes ?? 0;
  const rangeBlock =
    sTier >= 2 ? Math.max(0.48, t.rangeAgreementBlock - 0.04) : t.rangeAgreementBlock;

  if (regime === "range" && direction !== "range") {
    if (dirAgree < rangeBlock && sTier < 2) {
      d = "range";
      c = 0.48;
      blocked = true;
      reason = "range regime — low agreement directional blocked";
    } else {
      c *= 0.85;
      reason = "range regime — reduced confidence";
    }
  }

  if (regime === "high_vol" && direction !== "range") {
    c = Math.min(c, 0.72);
    reason = "high vol — capped confidence";
  }

  if (regime === "trend_up" && direction === "down" && agreement < t.counterTrendAgreement) {
    d = "range";
    c = 0.5;
    blocked = true;
    reason = "uptrend regime blocks counter-trend short";
  }

  if (regime === "trend_down" && direction === "up" && agreement < t.counterTrendAgreement) {
    d = "range";
    c = 0.5;
    blocked = true;
    reason = "downtrend regime blocks counter-trend long";
  }

  if (direction === "up" && sentiment < -0.35) {
    c *= 0.75;
    reason += " | negative sentiment";
  }
  if (direction === "down" && sentiment > 0.35) {
    c *= 0.75;
    reason += " | positive sentiment";
  }

  return {
    direction: d,
    confidence: Number(Math.min(0.95, c).toFixed(4)),
    regime,
    blocked,
    reason,
  };
}
