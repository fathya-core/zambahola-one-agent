import { readJsonSafe, writeJsonAtomic } from "../storage/json-io.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FeatureVector } from "../features/index.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL_FILE = join(pkgRoot, "data", "learning", "meta-pnl-weights.json");

/** Model 2 — «هل الصفقة تستحق الدخول؟» من نتائج PnL الفعلية */
const DIM = 7;

export interface MetaPnlState {
  weights: number[];
  bias: number;
  samples: number;
  winRate: number;
  lastProb: number;
}

const DEFAULT: MetaPnlState = {
  weights: [0.85, 0.7, -0.5, -0.4, 0.35, 0.2, 0.15],
  bias: -0.2,
  samples: 0,
  winRate: 0,
  lastProb: 0.5,
};

let state: MetaPnlState | null = null;
let loadPromise: Promise<MetaPnlState> | null = null;

function sigmoid(z: number): number {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

function featureRow(
  f: FeatureVector,
  confidence: number,
  agreement: number,
  regime: string,
): number[] {
  const regimeTrend =
    regime === "trend_up" ? 1 : regime === "trend_down" ? -1 : 0;
  return [
    confidence,
    agreement,
    f.volatility * 10_000,
    f.spreadBps,
    f.bookImbalance,
    f.momentumNorm,
    regimeTrend,
  ];
}

async function load(): Promise<MetaPnlState> {
  const s = await readJsonSafe<MetaPnlState>(MODEL_FILE);
  return s?.weights?.length === DIM ? { ...DEFAULT, ...s } : { ...DEFAULT };
}

export async function getMetaPnlModel(): Promise<{
  score: (
    f: FeatureVector,
    confidence: number,
    agreement: number,
    regime: string,
  ) => number;
  shouldEnter: (
    f: FeatureVector,
    confidence: number,
    agreement: number,
    regime: string,
  ) => boolean;
  train: (
    f: FeatureVector,
    confidence: number,
    agreement: number,
    regime: string,
    profitable: boolean,
  ) => Promise<void>;
  getState: () => MetaPnlState;
}> {
  if (!loadPromise) loadPromise = load();
  state = await loadPromise;

  const threshold = Number(process.env.ZAMBAHOLA_META_PNL_THRESHOLD ?? 0.55);
  const lr = Number(process.env.ZAMBAHOLA_META_PNL_LR ?? 0.1);

  const score = (f, confidence, agreement, regime) => {
    const x = featureRow(f, confidence, agreement, regime);
    let z = state!.bias;
    for (let i = 0; i < DIM; i++) z += state!.weights[i]! * x[i]!;
    const p = sigmoid(z);
    state!.lastProb = Number(p.toFixed(4));
    return p;
  };

  const shouldEnter = (f, confidence, agreement, regime) => {
    if (process.env.ZAMBAHOLA_META_PNL === "0") return true;
    if (state!.samples < Number(process.env.ZAMBAHOLA_META_PNL_WARMUP ?? 8)) return true;
    return score(f, confidence, agreement, regime) >= threshold;
  };

  return {
    score,
    shouldEnter,
    async train(f, confidence, agreement, regime, profitable) {
      const x = featureRow(f, confidence, agreement, regime);
      let z = state!.bias;
      for (let i = 0; i < DIM; i++) z += state!.weights[i]! * x[i]!;
      const pred = sigmoid(z);
      const y = profitable ? 1 : 0;
      const err = y - pred;
      for (let i = 0; i < DIM; i++) {
        state!.weights[i] = Number(
          (state!.weights[i]! + lr * err * x[i]!).toFixed(6),
        );
      }
      state!.bias = Number((state!.bias + lr * err).toFixed(6));
      state!.samples += 1;
      state!.winRate = Number(
        (state!.winRate * 0.92 + (profitable ? 1 : 0) * 0.08).toFixed(4),
      );
      if (state!.samples % 3 === 0) {
        await writeJsonAtomic(MODEL_FILE, state);
      }
    },
    getState() {
      return { ...state! };
    },
  };
}
