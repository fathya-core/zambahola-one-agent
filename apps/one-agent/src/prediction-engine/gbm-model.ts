import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  featuresToArray,
  type FeatureVector,
  directionFromScore,
  FEATURE_DIM,
} from "../features/index.js";
import type { PredictionDirection } from "../types.js";
import { safeProb, safeScore } from "../learning/safe-prob.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GBM_FILE = join(pkgRoot, "data", "learning", "gbm-trees.json");

const TREES = 32;
const LR = 0.15;

interface Stump {
  featureIdx: number;
  threshold: number;
  leftValue: number;
  rightValue: number;
}

export class GBMModel {
  private trees: Stump[] = [];
  private samples = 0;

  async load(): Promise<void> {
    if (!existsSync(GBM_FILE)) return;
    try {
      const d = JSON.parse(await readFile(GBM_FILE, "utf8")) as {
        trees: Stump[];
        samples: number;
      };
      if (d.trees?.length) {
        this.trees = d.trees;
        this.samples = d.samples ?? 0;
      }
    } catch {
      /* */
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(GBM_FILE), { recursive: true });
    await writeFile(
      GBM_FILE,
      JSON.stringify({ trees: this.trees, samples: this.samples }, null, 2),
      "utf8",
    );
  }

  predict(f: FeatureVector): { score: number; direction: PredictionDirection; prob: number } {
    const x = featuresToArray(f);
    let sum = 0;
    for (const t of this.trees) {
      sum += x[t.featureIdx]! <= t.threshold ? t.leftValue : t.rightValue;
    }
    const prob = safeProb(sigmoid(sum));
    const score = safeScore((prob - 0.5) * 2);
    return {
      score,
      direction: directionFromScore(score),
      prob,
    };
  }

  async train(f: FeatureVector, label: number): Promise<void> {
    const x = featuresToArray(f);
    let pred = 0;
    for (const t of this.trees) {
      pred += x[t.featureIdx]! <= t.threshold ? t.leftValue : t.rightValue;
    }
    const err = label - sigmoid(pred);
    const stump = fitStump(x, err);
    this.trees.push(stump);
    if (this.trees.length > TREES) this.trees.shift();
    this.samples += 1;
    if (this.samples % 8 === 0) await this.save();
  }

  async batchTrain(samples: Array<{ f: FeatureVector; label: number }>): Promise<void> {
    for (const s of samples) {
      await this.train(s.f, s.label);
    }
    await this.save();
  }

  getSampleCount(): number {
    return this.samples;
  }
}

function fitStump(x: number[], residual: number): Stump {
  let bestIdx = 1;
  let bestThr = 0;
  let bestErr = Infinity;
  const thresholds = [-0.35, -0.15, 0, 0.15, 0.35];
  for (let idx = 1; idx < Math.min(FEATURE_DIM, x.length); idx++) {
    for (const thr of thresholds) {
      const left = residual * (x[idx]! <= thr ? 1 : 0);
      const right = residual * (x[idx]! > thr ? 1 : 0);
      const err = Math.abs(left) + Math.abs(right);
      if (err < bestErr) {
        bestErr = err;
        bestIdx = idx;
        bestThr = thr;
      }
    }
  }
  return {
    featureIdx: bestIdx,
    threshold: bestThr,
    leftValue: LR * residual,
    rightValue: -LR * residual,
  };
}

function sigmoid(z: number): number {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

export { GBM_FILE };
