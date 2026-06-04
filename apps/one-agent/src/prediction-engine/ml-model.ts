import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type FeatureVector,
  featuresToArray,
  directionFromScore,
} from "../features/index.js";
import type { PredictionDirection } from "../types.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL_FILE = join(pkgRoot, "data", "learning", "ml-weights.json");

const LR = 0.08;
const L2 = 0.001;

export class OnlineMLModel {
  private weights: number[] = [0, 0.5, 0.3, 0.2, -0.1, -0.2, 0.4, -0.15, 0.25, 0.35];
  private samples = 0;

  async load(): Promise<void> {
    if (!existsSync(MODEL_FILE)) return;
    try {
      const data = JSON.parse(await readFile(MODEL_FILE, "utf8")) as {
        weights: number[];
        samples: number;
      };
      if (Array.isArray(data.weights) && data.weights.length === this.weights.length) {
        this.weights = data.weights;
        this.samples = data.samples ?? 0;
      }
    } catch {
      /* defaults */
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(MODEL_FILE), { recursive: true });
    await writeFile(
      MODEL_FILE,
      JSON.stringify({ weights: this.weights, samples: this.samples }, null, 2),
      "utf8",
    );
  }

  predict(features: FeatureVector): { score: number; direction: PredictionDirection; prob: number } {
    const x = featuresToArray(features);
    const z = dot(this.weights, x);
    const prob = sigmoid(z);
    const score = (prob - 0.5) * 2;
    return {
      score,
      direction: directionFromScore(score),
      prob: Number(prob.toFixed(4)),
    };
  }

  /** Train: label 1 = up hit, 0 = down hit, 0.5 = range */
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
      this.weights[i] =
        this.weights[i]! + LR * (err * x[i]! - L2 * this.weights[i]!);
    }
    this.samples += 1;
    if (this.samples % 5 === 0) await this.save();
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
  };
}

export function labelFromHit(
  direction: PredictionDirection,
  hit: boolean,
): number {
  if (direction === "up") return hit ? 1 : 0;
  if (direction === "down") return hit ? 0 : 1;
  return 0.5;
}

export { MODEL_FILE };
