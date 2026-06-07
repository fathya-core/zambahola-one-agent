import type { FeatureVector } from "../features/index.js";
import type { PredictionDirection } from "../types.js";
import { getOrderBook } from "../market-feed/orderbook.js";
import { isLearnTradeActive } from "../config/hybrid-mode.js";

export interface MicrostructureGateResult {
  direction: PredictionDirection;
  confidence: number;
  blocked: boolean;
  reason: string;
}

function gatesEnabled(): boolean {
  if (isLearnTradeActive()) return false;
  return process.env.ZAMBAHOLA_MICRO_GATES !== "0";
}

export function applyMicrostructureGates(
  direction: PredictionDirection,
  confidence: number,
  features: FeatureVector,
): MicrostructureGateResult {
  if (!gatesEnabled() || direction === "range") {
    return { direction, confidence, blocked: false, reason: "micro_gates_off" };
  }

  const book = getOrderBook();
  const spreadBp = book?.spreadBps ?? features.spreadBps * 100;
  const maxSpread = Number(process.env.ZAMBAHOLA_MAX_SPREAD_BP ?? 5);
  const maxVol = Number(process.env.ZAMBAHOLA_MAX_VOL ?? 0.0035);
  const minImb = Number(process.env.ZAMBAHOLA_MIN_BOOK_IMBALANCE ?? 0.08);

  if (spreadBp > maxSpread) {
    return {
      direction: "range",
      confidence: 0.44,
      blocked: true,
      reason: `micro_spread_${spreadBp.toFixed(1)}bp_gt_${maxSpread}`,
    };
  }

  if (features.volatility > maxVol) {
    return {
      direction: "range",
      confidence: 0.45,
      blocked: true,
      reason: `micro_vol_${(features.volatility * 100).toFixed(3)}pct`,
    };
  }

  const imb = book?.imbalance ?? features.bookImbalance;
  const depth5 = book?.imbalance5 ?? imb;
  const aligned =
    direction === "up"
      ? imb >= minImb || depth5 >= minImb
      : direction === "down"
        ? imb <= -minImb || depth5 <= -minImb
        : true;

  if (!aligned && confidence < 0.72) {
    return {
      direction: "range",
      confidence: 0.46,
      blocked: true,
      reason: `micro_imbalance_misaligned_${imb.toFixed(3)}`,
    };
  }

  const minMain = Number(process.env.ZAMBAHOLA_MIN_MAIN_PROB ?? 0.58);
  if (confidence < minMain) {
    return {
      direction: "range",
      confidence: 0.47,
      blocked: true,
      reason: `micro_main_prob_${confidence.toFixed(3)}_lt_${minMain}`,
    };
  }

  return { direction, confidence, blocked: false, reason: "micro_pass" };
}
