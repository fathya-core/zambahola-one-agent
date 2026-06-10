import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_DIM } from "../features/index.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const ML_WEIGHTS_FILE = join(pkgRoot, "data", "learning", "ml-weights.json");
export const MLP_WEIGHTS_FILE = join(pkgRoot, "data", "learning", "mlp-weights.json");

export const ML_DEFAULT_WEIGHTS = [
  0, 0.4, 0.25, 0.15, -0.1, -0.2, 0.35, -0.12, 0.2, 0.28, 0.38, -0.06, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05,
];

const MLP_H1 = 16;
const MLP_H2 = 8;
const DEAD_EPS = 1e-8;

function initW(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() - 0.5) * 0.08),
  );
}

function initVec(n: number): number[] {
  return Array.from({ length: n }, () => (Math.random() - 0.5) * 0.08);
}

export function freshMlpState(): {
  W1: number[][];
  b1: number[];
  W2: number[][];
  b2: number[];
  W3: number[];
  b3: number;
} {
  return {
    W1: initW(FEATURE_DIM, MLP_H1),
    b1: new Array(MLP_H1).fill(0),
    W2: initW(MLP_H1, MLP_H2),
    b2: new Array(MLP_H2).fill(0),
    W3: initVec(MLP_H2),
    b3: 0,
  };
}

export function sumAbsNumbers(values: unknown): number {
  const walk = (v: unknown): number => {
    if (typeof v === "number") return Number.isFinite(v) ? Math.abs(v) : 0;
    if (Array.isArray(v)) return v.reduce((s, x) => s + walk(x), 0);
    if (v && typeof v === "object") {
      return Object.values(v).reduce((s, x) => s + walk(x), 0);
    }
    return 0;
  };
  return walk(values);
}

export function normalizeMlWeights(weights: unknown): number[] | null {
  if (!Array.isArray(weights) || weights.length !== FEATURE_DIM) return null;
  return weights.map((w) => {
    if (w === null || w === undefined || !Number.isFinite(w)) return 0;
    return w;
  });
}

/** Dead = always predicts 0.5 (all zero/null/NaN or collapsed to ~0). */
export function isDeadMlWeights(weights: unknown, samples = 0): boolean {
  const normalized = normalizeMlWeights(weights);
  if (!normalized) return true;
  if (normalized.every((w) => w === 0)) return true;
  if (samples >= 20 && sumAbsNumbers(normalized) < DEAD_EPS) return true;
  return false;
}

export interface MlpWeightBlob {
  W1?: number[][];
  W2?: number[][];
  W3?: number[];
  b3?: number;
  samples?: number;
}

export function hasBadNumbers(values: unknown): boolean {
  const walk = (v: unknown): boolean => {
    if (typeof v === "number") return !Number.isFinite(v);
    if (v === null) return true;
    if (Array.isArray(v)) return v.some(walk);
    if (v && typeof v === "object") return Object.values(v).some(walk);
    return false;
  };
  return walk(values);
}

/** Dead when output layer cannot move prob away from 0.5. */
export function isDeadMlpWeights(data: MlpWeightBlob): boolean {
  if (!data?.W1 || !data.W3) return true;
  if (hasBadNumbers(data)) return true;
  const outSum = sumAbsNumbers(data.W3) + Math.abs(Number.isFinite(data.b3) ? data.b3! : 0);
  const bodySum = sumAbsNumbers(data.W1) + sumAbsNumbers(data.W2);
  if (outSum < DEAD_EPS) {
    const samples = data.samples ?? 0;
    if (samples >= 20 || bodySum < DEAD_EPS) return true;
  }
  return false;
}

export function sanitizeJsonNumbers<T>(value: T): T {
  if (typeof value === "number") {
    return (Number.isFinite(value) ? value : 0) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeJsonNumbers(v)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeJsonNumbers(v);
    }
    return out as T;
  }
  return value;
}

export async function restoreMlWeightsFile(samples = 0): Promise<void> {
  await mkdir(dirname(ML_WEIGHTS_FILE), { recursive: true });
  await writeFile(
    ML_WEIGHTS_FILE,
    JSON.stringify(
      { weights: [...ML_DEFAULT_WEIGHTS], samples, dim: FEATURE_DIM },
      null,
      2,
    ),
    "utf8",
  );
}

export async function restoreMlpWeightsFile(samples = 0): Promise<void> {
  await mkdir(dirname(MLP_WEIGHTS_FILE), { recursive: true });
  await writeFile(
    MLP_WEIGHTS_FILE,
    JSON.stringify({ ...freshMlpState(), samples }, null, 2),
    "utf8",
  );
}

export async function restoreMlMlpWeights(): Promise<{
  mlRestored: boolean;
  mlpRestored: boolean;
  mlSamples: number;
  mlpSamples: number;
}> {
  let mlSamples = 0;
  let mlpSamples = 0;
  if (existsSync(ML_WEIGHTS_FILE)) {
    try {
      const data = JSON.parse(await readFile(ML_WEIGHTS_FILE, "utf8")) as { samples?: number };
      mlSamples = data.samples ?? 0;
    } catch {
      /* */
    }
  }
  if (existsSync(MLP_WEIGHTS_FILE)) {
    try {
      const data = JSON.parse(await readFile(MLP_WEIGHTS_FILE, "utf8")) as { samples?: number };
      mlpSamples = data.samples ?? 0;
    } catch {
      /* */
    }
  }
  await restoreMlWeightsFile(mlSamples);
  await restoreMlpWeightsFile(mlpSamples);
  return { mlRestored: true, mlpRestored: true, mlSamples, mlpSamples };
}
