import type { PredictionDirection } from "../types.js";
import { getOrderBook } from "../market-feed/orderbook.js";
import { getLobSeries } from "../market-feed/lob-history.js";
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
  // v0.8 depth features (appended at end so existing model weights stay aligned).
  // Order-book / microstructure features dominate short-horizon crypto direction
  // (research: ~80% of predictive power), so these are the high-value additions.
  ret20: number; // multi-timeframe momentum (longer lookback)
  deepImbalance: number; // top-20 LOB depth imbalance
  bookImbalanceDelta: number; // order-flow imbalance momentum (change in pressure)
  vwapDevNorm: number; // VWAP-to-mid deviation
  oiChangeNorm: number; // open-interest change
  volAccel: number; // short vs long volatility ratio (regime acceleration)
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

  // --- v0.8 depth features ---
  const ret20 = prices.length > 20 ? ret(20) : 0;

  // Deep (top-20) order-book imbalance — already in [-1,1].
  const deepImbalance = Math.max(-1, Math.min(1, book?.imbalance20 ?? book?.imbalance ?? 0));

  // Order-flow imbalance momentum: change in book pressure over the LOB history.
  const lobImb = getLobSeries().imbalance;
  let bookImbalanceDelta = 0;
  if (lobImb.length >= 8) {
    const k = 4;
    const recent = avg(lobImb.slice(-k));
    const prev = avg(lobImb.slice(-2 * k, -k));
    bookImbalanceDelta = clamp(-1, 1, (recent - prev) * 3);
  }

  // VWAP-to-mid deviation (mean-reversion / pressure signal).
  const vwN = Math.min(20, prices.length);
  let pv = 0;
  let vv = 0;
  for (let i = prices.length - vwN; i < prices.length; i++) {
    const w = volumes[i] ?? 1;
    pv += prices[i]! * w;
    vv += w;
  }
  const vwap = vv > 0 ? pv / vv : p;
  const vwapDevNorm = clamp(-1, 1, ((p - vwap) / (vwap || 1)) * 2000);

  // Open-interest change (derivatives flow).
  const oiChange = getMarketSignals().openInterestChange ?? 0;
  const oiChangeNorm = clamp(-1, 1, oiChange * 50);

  // Volatility acceleration: short-window vol vs the 10-tick vol.
  const shortVol = returns.length >= 5 ? stdOf(returns.slice(-5)) : vol;
  const volAccel = clamp(-1, 1, vol > 0 ? shortVol / vol - 1 : 0);

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
    ret20,
    deepImbalance,
    bookImbalanceDelta,
    vwapDevNorm,
    oiChangeNorm,
    volAccel,
  };
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function stdOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s, r) => s + (r - m) ** 2, 0) / arr.length);
}

function clamp(lo: number, hi: number, v: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));
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
    f.ret20,
    f.deepImbalance,
    f.bookImbalanceDelta,
    f.vwapDevNorm,
    f.oiChangeNorm,
    f.volAccel,
  ];
}

/** Number of named features in FeatureVector. */
export const FEATURE_DIM = 24;

/**
 * Length of the model input vector produced by featuresToArray():
 * FEATURE_DIM features + 1 leading bias term. All linear/neural models
 * must size their weights to INPUT_DIM, not FEATURE_DIM.
 */
export const INPUT_DIM = FEATURE_DIM + 1;

export function directionFromScore(score: number): PredictionDirection {
  if (score > 0.12) return "up";
  if (score < -0.12) return "down";
  return "range";
}

/** Coerce a partial/loose feature map into a complete, NaN-free FeatureVector. */
export function normalizeFeatureVector(
  f: FeatureVector | Record<string, number>,
): FeatureVector {
  const n = (v: number | undefined): number => (Number.isFinite(v) ? (v as number) : 0);
  return {
    ret1: n(f.ret1),
    ret5: n(f.ret5),
    ret10: n(f.ret10),
    volatility: n(f.volatility),
    rsiNorm: n(f.rsiNorm),
    momentumNorm: n(f.momentumNorm),
    zScore: n(f.zScore),
    sentiment: n(f.sentiment),
    agreement: n(f.agreement),
    bookImbalance: n(f.bookImbalance),
    spreadBps: n(f.spreadBps),
    macdHistNorm: n(f.macdHistNorm),
    fundingNorm: n(f.fundingNorm),
    premiumNorm: n(f.premiumNorm),
    longShortNorm: n(f.longShortNorm),
    volumeNorm: n(f.volumeNorm),
    timeSin: n(f.timeSin),
    timeCos: n(f.timeCos),
    ret20: n(f.ret20),
    deepImbalance: n(f.deepImbalance),
    bookImbalanceDelta: n(f.bookImbalanceDelta),
    vwapDevNorm: n(f.vwapDevNorm),
    oiChangeNorm: n(f.oiChangeNorm),
    volAccel: n(f.volAccel),
  };
}
