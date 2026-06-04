import type { PredictionDirection } from "../types.js";
import type { FeatureVector } from "../features/index.js";

export type MarketRegime = "trend_up" | "trend_down" | "range" | "high_vol";

export function detectRegime(f: FeatureVector): MarketRegime {
  if (f.volatility > 0.00045) {
    if (f.momentumNorm > 0.25) return "trend_up";
    if (f.momentumNorm < -0.25) return "trend_down";
    return "high_vol";
  }
  if (Math.abs(f.momentumNorm) < 0.12 && Math.abs(f.zScore) < 0.5) return "range";
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
): GatedSignal {
  let d = direction;
  let c = confidence;
  let blocked = false;
  let reason = "passed";

  if (regime === "range" && direction !== "range") {
    if (agreement < 0.55) {
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

  if (regime === "trend_up" && direction === "down" && agreement < 0.6) {
    d = "range";
    c = 0.5;
    blocked = true;
    reason = "uptrend regime blocks counter-trend short";
  }

  if (regime === "trend_down" && direction === "up" && agreement < 0.6) {
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
