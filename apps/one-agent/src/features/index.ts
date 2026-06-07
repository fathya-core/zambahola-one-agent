import type { PredictionDirection } from "../types.js";
import { getOrderBook } from "../market-feed/orderbook.js";
import { getMarketSignals, signalsToFeatures } from "../market-signals/index.js";
import { localHourFraction } from "../lib/time-display.js";
import { WelfordWindow } from "../lib/welford.js";

const imbZ = new WelfordWindow(Number(process.env.ZAMBAHOLA_IMB_Z_WINDOW ?? 100));

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
  bookImbalance: number;
  spreadBps: number;
  macdHistNorm: number;
  fundingNorm: number;
  premiumNorm: number;
  longShortNorm: number;
  volumeNorm: number;
  timeSin: number;
  timeCos: number;
}

export function extractFeatures(
  prices: number[],
  volumes: number[],
  sentiment = 0,
  agreement = 0,
  timestamp = Date.now(),
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

  const book = getOrderBook();
  const rawImb = book?.imbalance5 ?? book?.imbalance ?? 0;
  imbZ.push(rawImb);
  const bookImbalance =
    imbZ.size() >= 12 ? imbZ.zScore(rawImb) / 3 : rawImb;
  const spreadBps = book ? book.spreadBps / 100 : 0;

  const macdHistNorm = computeMacdHistNorm(prices);
  const sig = signalsToFeatures(getMarketSignals());

  const volSlice = volumes.slice(-10);
  const avgVol = volSlice.length ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 1;
  const lastVol = volumes[volumes.length - 1] ?? avgVol;
  const volumeNorm = Math.max(-1, Math.min(1, (lastVol - avgVol) / (avgVol || 1)));

  const hour = localHourFraction(timestamp);
  const timeSin = Math.sin((hour / 24) * Math.PI * 2);
  const timeCos = Math.cos((hour / 24) * Math.PI * 2);

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
    bookImbalance: Math.max(-1, Math.min(1, bookImbalance)),
    spreadBps: Math.min(1, spreadBps),
    macdHistNorm,
    fundingNorm: sig.fundingNorm,
    premiumNorm: sig.premiumNorm,
    longShortNorm: sig.longShortNorm,
    volumeNorm,
    timeSin,
    timeCos,
  };
}

function computeMacdHistNorm(prices: number[]): number {
  if (prices.length < 26) return 0;
  const ema = (arr: number[], p: number) => {
    const k = 2 / (p + 1);
    let v = arr[0]!;
    for (const x of arr) v = x * k + v * (1 - k);
    return v;
  };
  const e12 = ema(prices, 12);
  const e26 = ema(prices, 26);
  const hist = e12 - e26;
  return Math.max(-1, Math.min(1, hist / (prices[prices.length - 1]! * 0.0005)));
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
    f.bookImbalance,
    f.spreadBps,
    f.macdHistNorm,
    f.fundingNorm,
    f.premiumNorm,
    f.longShortNorm,
    f.volumeNorm,
    f.timeSin,
    f.timeCos,
  ];
}

export const FEATURE_DIM = 18;

export function directionFromScore(score: number): PredictionDirection {
  if (score > 0.12) return "up";
  if (score < -0.12) return "down";
  return "range";
}
