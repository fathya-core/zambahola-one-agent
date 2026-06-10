import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type FeatureVector,
  featuresToArray,
  directionFromScore,
  FEATURE_DIM,
} from "../features/index.js";
import type { PredictionDirection } from "../types.js";
import { safeProb, safeScore } from "../learning/safe-prob.js";
import {
  isDeadMlWeights,
  ML_DEFAULT_WEIGHTS,
  normalizeMlWeights,
} from "../learning/model-weight-health.js";

export { ML_DEFAULT_WEIGHTS };

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL_FILE = join(pkgRoot, "data", "learning", "ml-weights.json");

const LR = 0.1;
const L2 = 0.001;

export class OnlineMLModel {
  private weights: number[] = [...ML_DEFAULT_WEIGHTS];
  private samples = 0;

  async load(): Promise<void> {
    if (!existsSync(MODEL_FILE)) return;
    try {
      const data = JSON.parse(await readFile(MODEL_FILE, "utf8")) as {
        weights: number[];
        samples: number;
      };
      const samples = data.samples ?? 0;
      const normalized = normalizeMlWeights(data.weights);
      if (normalized && !isDeadMlWeights(normalized, samples)) {
        this.weights = normalized;
        this.samples = samples;
      } else if (existsSync(MODEL_FILE)) {
        this.weights = [...ML_DEFAULT_WEIGHTS];
        this.samples = samples;
        await this.save();
      }
    } catch {
      /* */
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(MODEL_FILE), { recursive: true });
    await writeFile(
      MODEL_FILE,
      JSON.stringify({ weights: this.weights, samples: this.samples, dim: FEATURE_DIM }, null, 2),
      "utf8",
    );
  }

  predict(features: FeatureVector): { score: number; direction: PredictionDirection; prob: number } {
    const x = featuresToArray(features);
    const z = dot(this.weights, x);
    const prob = safeProb(sigmoid(z));
    const score = safeScore((prob - 0.5) * 2);
    return {
      score,
      direction: directionFromScore(score),
      prob,
    };
  }

  async train(
    features: FeatureVector | Record<string, number>,
    label: number,
  ): Promise<void> {
    const f = normalizeFeatures(features);
    const x = featuresToArray(f);
    const z = dot(this.weights, x);
    const pred = sigmoid(z);
    const err = label - pred;
    for (let i = 0; i < this.weights.length; i++) {
      const next =
        this.weights[i]! + LR * (err * x[i]! - L2 * this.weights[i]!);
      this.weights[i] = Number.isFinite(next) ? next : ML_DEFAULT_WEIGHTS[i]!;
    }
    this.samples += 1;
    if (this.samples % 3 === 0) await this.save();
  }

  getWeights(): number[] {
    return [...this.weights];
  }

  getSampleCount(): number {
    return this.samples;
  }
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function sigmoid(z: number): number {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

function normalizeFeatures(
  f: FeatureVector | Record<string, number>,
): FeatureVector {
  return {
    ret1: f.ret1 ?? 0,
    ret5: f.ret5 ?? 0,
    ret10: f.ret10 ?? 0,
    volatility: f.volatility ?? 0,
    rsiNorm: f.rsiNorm ?? 0,
    momentumNorm: f.momentumNorm ?? 0,
    zScore: f.zScore ?? 0,
    sentiment: f.sentiment ?? 0,
    agreement: f.agreement ?? 0,
    bookImbalance: f.bookImbalance ?? 0,
    spreadBps: f.spreadBps ?? 0,
    macdHistNorm: f.macdHistNorm ?? 0,
    fundingNorm: f.fundingNorm ?? 0,
    premiumNorm: f.premiumNorm ?? 0,
    longShortNorm: f.longShortNorm ?? 0,
    volumeNorm: f.volumeNorm ?? 0,
    timeSin: f.timeSin ?? 0,
    timeCos: f.timeCos ?? 0,
  };
}

export { MODEL_FILE };
