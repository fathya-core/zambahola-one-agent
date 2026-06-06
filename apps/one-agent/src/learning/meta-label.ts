import { readJsonSafe, writeJsonAtomic } from "../storage/json-io.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureVector } from "../features/index.js";
import type { PredictionDirection } from "../types.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL_FILE = join(pkgRoot, "data", "learning", "meta-label-weights.json");

/** [agreement, confidence, volatility*1e4, spreadBps/10, bookImbalance] */
const DIM = 5;

export interface MetaLabelState {
  weights: number[];
  bias: number;
  samples: number;
  trustRate: number;
  lastProb: number;
}

const DEFAULT: MetaLabelState = {
  weights: [1.2, 0.9, -0.4, -0.35, 0.25],
  bias: -0.15,
  samples: 0,
  trustRate: 0,
  lastProb: 0.5,
};

let state: MetaLabelState | null = null;
let loadPromise: Promise<MetaLabelState> | null = null;

function sigmoid(z: number): number {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

function featureRow(
  f: FeatureVector,
  confidence: number,
  agreement: number,
): number[] {
  return [
    agreement,
    confidence,
    f.volatility * 10_000,
    f.spreadBps / 10,
    f.bookImbalance,
  ];
}

async function load(): Promise<MetaLabelState> {
  const s = await readJsonSafe<MetaLabelState>(MODEL_FILE);
  return s?.weights?.length === DIM ? { ...DEFAULT, ...s } : { ...DEFAULT };
}

export async function getMetaLabeler(): Promise<{
  score: (
    f: FeatureVector,
    confidence: number,
    agreement: number,
  ) => number;
  shouldTrust: (
    f: FeatureVector,
    confidence: number,
    agreement: number,
  ) => boolean;
  train: (
    f: FeatureVector,
    confidence: number,
    agreement: number,
    direction: PredictionDirection,
    hit: boolean,
  ) => Promise<void>;
  getState: () => MetaLabelState;
}> {
  if (!loadPromise) loadPromise = load();
  state = await loadPromise;

  const threshold = Number(process.env.ZAMBAHOLA_META_THRESHOLD ?? 0.52);
  const lr = Number(process.env.ZAMBAHOLA_META_LR ?? 0.12);

  const score = (f: FeatureVector, confidence: number, agreement: number) => {
    const x = featureRow(f, confidence, agreement);
    let z = state!.bias;
    for (let i = 0; i < DIM; i++) z += state!.weights[i]! * x[i]!;
    const p = sigmoid(z);
    state!.lastProb = Number(p.toFixed(4));
    return p;
  };

  const shouldTrust = (f: FeatureVector, confidence: number, agreement: number) => {
    if (process.env.ZAMBAHOLA_META_LABEL === "0") return true;
    return score(f, confidence, agreement) >= threshold;
  };

  return {
    score,
    shouldTrust,

    async train(f, confidence, agreement, direction, hit) {
      if (direction === "range") return;
      const x = featureRow(f, confidence, agreement);
      let z = state!.bias;
      for (let i = 0; i < DIM; i++) z += state!.weights[i]! * x[i]!;
      const pred = sigmoid(z);
      const y = hit ? 1 : 0;
      const err = y - pred;
      for (let i = 0; i < DIM; i++) {
        state!.weights[i] = Number(
          (state!.weights[i]! + lr * err * x[i]!).toFixed(6),
        );
      }
      state!.bias = Number((state!.bias + lr * err).toFixed(6));
      state!.samples += 1;
      state!.trustRate = Number(
        (state!.trustRate * 0.95 + (hit ? 1 : 0) * 0.05).toFixed(4),
      );
      state!.lastProb = Number(pred.toFixed(4));
      if (state!.samples % 5 === 0) {
        await writeJsonAtomic(MODEL_FILE, state);
      }
    },

    getState() {
      return { ...state! };
    },
  };
}
