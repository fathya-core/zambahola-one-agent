import type { PredictionDirection } from "../types.js";

export const RANGE_BAND_PCT = 0.0008;

/** Volatility-adaptive band for batch training (optional via env) */
export function computeHitBand(price: number, volatility?: number): number {
  if (process.env.ZAMBAHOLA_TRAIN_VOL_BAND === "1") {
    const vol = volatility ?? 0.0003;
    return price * (vol > 0.00045 ? 0.0011 : 0.00085);
  }
  return price * RANGE_BAND_PCT;
}

export function isPredictionHit(
  direction: PredictionDirection,
  change: number,
  band: number,
): boolean {
  if (direction === "up") return change > band;
  if (direction === "down") return change < -band;
  return Math.abs(change) <= band;
}

/** Bars to skip ahead on 1m klines for a given horizon (seconds) */
export function horizonBarsAhead(horizonSec: number): number {
  return Math.max(1, Math.round(horizonSec / 60));
}
