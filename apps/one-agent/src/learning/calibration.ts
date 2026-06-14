import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonSafe, writeJsonAtomic } from "../storage/json-io.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CAL_FILE = join(pkgRoot, "data", "learning", "calibration.json");

const BUCKETS = 10;
// Below this we don't trust the isotonic map and pass confidence through.
const MIN_ISO_SAMPLES = Number(process.env.ZAMBAHOLA_CALIBRATION_MIN_SAMPLES ?? 200);
// 1.0 = fully isotonic-calibrated; 0 = raw confidence. We have >>1000 samples,
// so isotonic (PAVA) is the principled choice (see docs/ROADMAP.md research).
const ISO_BLEND = clamp01(Number(process.env.ZAMBAHOLA_CALIBRATION_BLEND ?? 0.85));

interface Bucket {
  predicted: number;
  actual: number;
  count: number;
}

/**
 * Pool Adjacent Violators Algorithm — fits a monotonic non-decreasing curve to
 * weighted observations. Standard method behind isotonic probability calibration.
 */
function pava(y: number[], w: number[]): number[] {
  const blocks: Array<{ sum: number; weight: number; start: number; len: number }> = [];
  for (let i = 0; i < y.length; i++) {
    let block = { sum: y[i]! * w[i]!, weight: w[i]!, start: i, len: 1 };
    while (
      blocks.length > 0 &&
      blocks[blocks.length - 1]!.sum / blocks[blocks.length - 1]!.weight >=
        block.sum / block.weight
    ) {
      const prev = blocks.pop()!;
      block = {
        sum: prev.sum + block.sum,
        weight: prev.weight + block.weight,
        start: prev.start,
        len: prev.len + block.len,
      };
    }
    blocks.push(block);
  }
  const out = new Array<number>(y.length).fill(0);
  for (const b of blocks) {
    const mean = b.sum / b.weight;
    for (let i = b.start; i < b.start + b.len; i++) out[i] = mean;
  }
  return out;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Piecewise-linear interpolation over (xs ascending, ys). */
function interp(x: number, xs: number[], ys: number[]): number {
  if (xs.length === 0) return x;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]!) {
      const x0 = xs[i - 1]!;
      const x1 = xs[i]!;
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return ys[i - 1]! + t * (ys[i]! - ys[i - 1]!);
    }
  }
  return ys[ys.length - 1]!;
}

export class ConfidenceCalibrator {
  private buckets: Bucket[] = Array.from({ length: BUCKETS }, (_, i) => ({
    predicted: (i + 0.5) / BUCKETS,
    actual: 0,
    count: 0,
  }));

  async load(): Promise<void> {
    const data = await readJsonSafe<{ buckets?: Bucket[] }>(CAL_FILE);
    if (data?.buckets?.length === BUCKETS) this.buckets = data.buckets;
  }

  async save(): Promise<void> {
    await writeJsonAtomic(CAL_FILE, { buckets: this.buckets });
  }

  record(confidence: number, hit: boolean): void {
    const idx = Math.min(BUCKETS - 1, Math.max(0, Math.floor(confidence * BUCKETS)));
    const b = this.buckets[idx]!;
    b.count += 1;
    b.actual += hit ? 1 : 0;
  }

  /** Isotonic (PAVA) fit over populated buckets → {x: centers, y: calibrated}. */
  private isotonicFit(): { x: number[]; y: number[] } {
    const populated = this.buckets.filter((b) => b.count > 0);
    if (populated.length === 0) return { x: [], y: [] };
    const x = populated.map((b) => b.predicted);
    const empirical = populated.map((b) => b.actual / b.count);
    const weights = populated.map((b) => b.count);
    const y = pava(empirical, weights);
    return { x, y };
  }

  calibrate(raw: number): number {
    const total = this.getTotalSamples();
    if (total < MIN_ISO_SAMPLES) return raw;
    const fit = this.isotonicFit();
    if (fit.x.length < 2) return raw;
    const iso = interp(raw, fit.x, fit.y);
    return Number((raw * (1 - ISO_BLEND) + iso * ISO_BLEND).toFixed(4));
  }

  /** Mean weighted |predicted - empirical| across populated buckets (0 = perfect). */
  getMiscalibration(): number {
    let err = 0;
    let n = 0;
    for (const b of this.buckets) {
      if (b.count === 0) continue;
      err += Math.abs(b.predicted - b.actual / b.count) * b.count;
      n += b.count;
    }
    return n > 0 ? Number((err / n).toFixed(4)) : 0;
  }

  getCalibrationScore(): number {
    let err = 0;
    let n = 0;
    for (const b of this.buckets) {
      if (b.count < 5) continue;
      const emp = b.actual / b.count;
      err += Math.abs(b.predicted - emp);
      n += 1;
    }
    return n > 0 ? Number((1 - err / n).toFixed(4)) : 0;
  }

  getReliabilityCurve(): Array<{
    bucket: number;
    predicted: number;
    empirical: number;
    calibrated: number;
    count: number;
    gap: number;
  }> {
    const fit = this.isotonicFit();
    return this.buckets.map((b, i) => {
      const empirical = b.count > 0 ? b.actual / b.count : 0;
      const calibrated =
        fit.x.length >= 2 ? Number(interp(b.predicted, fit.x, fit.y).toFixed(4)) : empirical;
      return {
        bucket: i,
        predicted: b.predicted,
        empirical: Number(empirical.toFixed(4)),
        calibrated,
        count: b.count,
        gap: Number(Math.abs(b.predicted - empirical).toFixed(4)),
      };
    });
  }

  getTotalSamples(): number {
    return this.buckets.reduce((s, b) => s + b.count, 0);
  }
}
