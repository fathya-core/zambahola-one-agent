import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { featuresToArray, type FeatureVector, directionFromScore, FEATURE_DIM } from "../features/index.js";
import type { PredictionDirection } from "../types.js";
import { safeProb, safeScore } from "../learning/safe-prob.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MLP_FILE = join(pkgRoot, "data", "learning", "mlp-weights.json");

const H1 = 16;
const H2 = 8;
const LR = 0.06;

export class MLPModel {
  private W1: number[][] = initW(FEATURE_DIM, H1);
  private b1: number[] = new Array(H1).fill(0);
  private W2: number[][] = initW(H1, H2);
  private b2: number[] = new Array(H2).fill(0);
  private W3: number[] = initVec(H2);
  private b3 = 0;
  private samples = 0;

  async load(): Promise<void> {
    if (!existsSync(MLP_FILE)) return;
    try {
      const d = JSON.parse(await readFile(MLP_FILE, "utf8"));
      if (d.W1) Object.assign(this, d);
    } catch {
      /* */
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(MLP_FILE), { recursive: true });
    await writeFile(
      MLP_FILE,
      JSON.stringify({
        W1: this.W1,
        b1: this.b1,
        W2: this.W2,
        b2: this.b2,
        W3: this.W3,
        b3: this.b3,
        samples: this.samples,
      }),
      "utf8",
    );
  }

  predict(f: FeatureVector): { score: number; direction: PredictionDirection; prob: number } {
    const { prob: raw } = this.forward(featuresToArray(f));
    const prob = safeProb(raw);
    const score = safeScore((prob - 0.5) * 2);
    return { score, direction: directionFromScore(score), prob };
  }

  async train(f: FeatureVector | Record<string, number>, label: number): Promise<void> {
    const feat = normalizeMlpFeatures(f);
    const x = featuresToArray(feat);
    const y = label;
    const { prob, h1, h2, z1, z2 } = this.forward(x);
    const err = y - prob;

    const dOut = err * prob * (1 - prob);
    for (let i = 0; i < H2; i++) {
      this.W3[i]! += LR * (dOut * h2[i]!);
    }
    this.b3 += LR * dOut;

    const dh2 = new Array(H2).fill(0);
    for (let i = 0; i < H2; i++) dh2[i] = dOut * this.W3[i]! * reluDeriv(z2[i]!);

    for (let i = 0; i < H2; i++) {
      for (let j = 0; j < H1; j++) {
        this.W2[i]![j]! += LR * (dh2[i]! * h1[j]!);
      }
      this.b2[i]! += LR * dh2[i]!;
    }

    const dh1 = new Array(H1).fill(0);
    for (let j = 0; j < H1; j++) {
      let s = 0;
      for (let i = 0; i < H2; i++) s += dh2[i]! * this.W2[i]![j]!;
      dh1[j] = s * reluDeriv(z1[j]!);
    }

    for (let j = 0; j < H1; j++) {
      for (let k = 0; k < FEATURE_DIM; k++) {
        this.W1[j]![k]! += LR * (dh1[j]! * x[k]!);
      }
      this.b1[j]! += LR * dh1[j]!;
    }

    this.samples += 1;
    if (this.samples % 5 === 0) await this.save();
  }

  getSampleCount(): number {
    return this.samples;
  }

  private forward(x: number[]) {
    const z1 = this.b1.map((b, j) => b + dot(this.W1[j]!, x));
    const h1 = z1.map(relu);
    const z2 = this.b2.map((b, i) => b + dot(this.W2[i]!, h1));
    const h2 = z2.map(relu);
    const z = this.b3 + dot(this.W3, h2);
    const prob = sigmoid(z);
    return { prob, h1, h2, z1, z2 };
  }
}

function initW(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() - 0.5) * 0.08),
  );
}

function initVec(n: number): number[] {
  return Array.from({ length: n }, () => (Math.random() - 0.5) * 0.08);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function relu(z: number): number {
  return Math.max(0, z);
}

function reluDeriv(z: number): number {
  return z > 0 ? 1 : 0;
}

function sigmoid(z: number): number {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

function normalizeMlpFeatures(
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

export { MLP_FILE };
