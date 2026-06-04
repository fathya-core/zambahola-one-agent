import type { PredictionDirection } from "../types.js";

export interface FeatureVector {
  ret1: number;
  ret5: number;
  ret10: number;
  volatility: number;
  rsiNorm: number;
  momentumNorm: number;
  zScore: number;
  sentiment: number;
  agreement: number;
}

export function extractFeatures(
  prices: number[],
  sentiment = 0,
  agreement = 0,
): FeatureVector | null {
  if (prices.length < 12) return null;

  const p = prices[prices.length - 1]!;
  const ret = (a: number) => (p - prices[prices.length - 1 - a]!) / prices[prices.length - 1 - a]!;

  const returns: number[] = [];
  for (let i = prices.length - 10; i < prices.length; i++) {
    returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const vol = Math.sqrt(
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length,
  );

  const slice = prices.slice(-20);
  const sma = slice.reduce((a, b) => a + b, 0) / slice.length;
  const std = Math.sqrt(slice.reduce((s, x) => s + (x - sma) ** 2, 0) / slice.length) || 1;
  const zScore = (p - sma) / std;

  let gains = 0;
  let losses = 0;
  for (let i = prices.length - 14; i < prices.length; i++) {
    const d = prices[i]! - prices[i - 1]!;
    if (d >= 0) gains += d;
    else losses -= d;
  }
  const rsi = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);

  const oldest = prices[prices.length - 8]!;
  const momentum = (p - oldest) / oldest;

  return {
    ret1: ret(1),
    ret5: prices.length > 5 ? ret(5) : 0,
    ret10: prices.length > 10 ? ret(10) : 0,
    volatility: vol,
    rsiNorm: (rsi - 50) / 50,
    momentumNorm: Math.max(-1, Math.min(1, momentum * 200)),
    zScore: Math.max(-2, Math.min(2, zScore)),
    sentiment: Math.max(-1, Math.min(1, sentiment)),
    agreement,
  };
}

export function featuresToArray(f: FeatureVector): number[] {
  return [
    1,
    f.ret1,
    f.ret5,
    f.ret10,
    f.volatility * 100,
    f.rsiNorm,
    f.momentumNorm,
    f.zScore,
    f.sentiment,
    f.agreement,
  ];
}

export const FEATURE_LABELS = [
  "bias",
  "ret1",
  "ret5",
  "ret10",
  "vol",
  "rsi",
  "mom",
  "z",
  "sentiment",
  "agreement",
] as const;

export function directionFromScore(score: number): PredictionDirection {
  if (score > 0.15) return "up";
  if (score < -0.15) return "down";
  return "range";
}
