import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type FeatureVector,
  featuresToArray,
  directionFromScore,
  normalizeFeatureVector,
  INPUT_DIM,
} from "../features/index.js";
import type { PredictionDirection } from "../types.js";
import { safeProb, safeScore } from "../learning/safe-prob.js";
import { readJsonSafe, writeJsonAtomic } from "../storage/json-io.js";
import { dot, sigmoid } from "./math-utils.js";
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
    const data = await readJsonSafe<{ weights?: number[]; samples?: number }>(MODEL_FILE);
    if (!data) return;
    const samples = data.samples ?? 0;
    const normalized = normalizeMlWeights(data.weights);
    if (normalized && !isDeadMlWeights(normalized, samples)) {
      this.weights = normalized;
      this.samples = samples;
    } else {
      this.weights = [...ML_DEFAULT_WEIGHTS];
      this.samples = samples;
      await this.save();
    }
  }

  async save(): Promise<void> {
    await writeJsonAtomic(MODEL_FILE, {
      weights: this.weights,
      samples: this.samples,
      dim: INPUT_DIM,
    });
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
    const f = normalizeFeatureVector(features);
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

export { MODEL_FILE };
