import { getLobSeries, lobSeriesReady } from "../market-feed/lob-history.js";
import type { PredictionDirection } from "../types.js";

const KERNEL = [0.25, 0.5, 0.25];

/** Lightweight 1D CNN proxy on LOB imbalance series — no GPU */
export function lobCnnPredict(): {
  score: number;
  direction: PredictionDirection;
  confidence: number;
  ready: boolean;
} {
  if (!lobSeriesReady(16)) {
    return { score: 0, direction: "range", confidence: 0.42, ready: false };
  }

  const { imbalance } = getLobSeries();
  const slice = imbalance.slice(-32);
  while (slice.length < 32) slice.unshift(0);

  const conv1 = conv1d(slice, KERNEL);
  const conv2 = conv1d(conv1, KERNEL);
  const pooled = conv2.slice(-8);
  const mean = pooled.reduce((a, b) => a + b, 0) / pooled.length;
  const trend = (pooled[pooled.length - 1]! - pooled[0]!) || 0;
  const score = mean * 0.7 + trend * 0.3;

  let direction: PredictionDirection = "range";
  if (score > 0.08) direction = "up";
  else if (score < -0.08) direction = "down";

  const confidence = Number(
    Math.min(0.9, 0.48 + Math.abs(score) * 1.2 + Math.abs(trend) * 0.5).toFixed(4),
  );

  return { score, direction, confidence, ready: true };
}

function conv1d(input: number[], kernel: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i <= input.length - kernel.length; i++) {
    let s = 0;
    for (let k = 0; k < kernel.length; k++) s += input[i + k]! * kernel[k]!;
    out.push(s);
  }
  return out.length ? out : input;
}
