import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  featuresToArray,
  type FeatureVector,
  directionFromScore,
  normalizeFeatureVector,
  INPUT_DIM,
} from "../features/index.js";
import type { PredictionDirection } from "../types.js";
import { safeProb, safeScore } from "../learning/safe-prob.js";
import { readJsonSafe, writeJsonAtomic } from "../storage/json-io.js";
import { dot, relu, reluDeriv, sigmoid } from "./math-utils.js";
import {
  freshMlpState,
  isDeadMlpWeights,
  isValidMlpShape,
  type MlpWeightBlob,
} from "../learning/model-weight-health.js";

export { freshMlpState };

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MLP_FILE = join(pkgRoot, "data", "learning", "mlp-weights.json");

const H1 = 16;
const H2 = 8;
const LR = 0.06;

function newMlpParams() {
  const s = freshMlpState();
  return { W1: s.W1, b1: s.b1, W2: s.W2, b2: s.b2, W3: s.W3, b3: s.b3 };
}

export class MLPModel {
  private params = newMlpParams();
  private get W1() {
    return this.params.W1;
  }
  private set W1(v: number[][]) {
    this.params.W1 = v;
  }
  private get b1() {
    return this.params.b1;
  }
  private set b1(v: number[]) {
    this.params.b1 = v;
  }
  private get W2() {
    return this.params.W2;
  }
  private set W2(v: number[][]) {
    this.params.W2 = v;
  }
  private get b2() {
    return this.params.b2;
  }
  private set b2(v: number[]) {
    this.params.b2 = v;
  }
  private get W3() {
    return this.params.W3;
  }
  private set W3(v: number[]) {
    this.params.W3 = v;
  }
  private get b3() {
    return this.params.b3;
  }
  private set b3(v: number) {
    this.params.b3 = v;
  }
  private samples = 0;

  async load(): Promise<void> {
    const d = await readJsonSafe<MlpWeightBlob>(MLP_FILE);
    if (!d) return;
    // Reset on wrong shape (e.g. legacy swapped-dimension files) or dead weights.
    if (!isValidMlpShape(d) || isDeadMlpWeights(d)) {
      this.params = newMlpParams();
      this.samples = d.samples ?? 0;
      await this.save();
      return;
    }
    this.params = {
      W1: d.W1!,
      b1: d.b1!,
      W2: d.W2!,
      b2: d.b2!,
      W3: d.W3!,
      b3: d.b3!,
    };
    this.samples = d.samples ?? 0;
  }

  async save(): Promise<void> {
    await writeJsonAtomic(MLP_FILE, {
      W1: this.W1,
      b1: this.b1,
      W2: this.W2,
      b2: this.b2,
      W3: this.W3,
      b3: this.b3,
      samples: this.samples,
    });
  }

  predict(f: FeatureVector): { score: number; direction: PredictionDirection; prob: number } {
    const { prob: raw } = this.forward(featuresToArray(f));
    const prob = safeProb(raw);
    const score = safeScore((prob - 0.5) * 2);
    return { score, direction: directionFromScore(score), prob };
  }

  async train(f: FeatureVector | Record<string, number>, label: number): Promise<void> {
    const feat = normalizeFeatureVector(f);
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
      for (let k = 0; k < INPUT_DIM; k++) {
        this.W1[j]![k]! += LR * (dh1[j]! * x[k]!);
      }
      this.b1[j]! += LR * dh1[j]!;
    }

    if (this.hasNonFiniteParams()) {
      const fresh = freshMlpState();
      this.W1 = fresh.W1;
      this.b1 = fresh.b1;
      this.W2 = fresh.W2;
      this.b2 = fresh.b2;
      this.W3 = fresh.W3;
      this.b3 = fresh.b3;
    }

    this.samples += 1;
    if (this.samples % 5 === 0) await this.save();
  }

  getSampleCount(): number {
    return this.samples;
  }

  private hasNonFiniteParams(): boolean {
    const bad = (n: number) => !Number.isFinite(n);
    if (bad(this.b3) || this.W3.some(bad)) return true;
    if (this.b1.some(bad) || this.b2.some(bad)) return true;
    if (this.W1.some((row) => row.some(bad))) return true;
    if (this.W2.some((row) => row.some(bad))) return true;
    return false;
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

export { MLP_FILE };
