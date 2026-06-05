import { readJsonSafe, writeJsonAtomic } from "../storage/json-io.js";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const LEARNING_STATE_FILE = join(pkgRoot, "data", "learning", "learning-state.json");

export interface LearningState {
  totalEvaluations: number;
  totalLearningUpdates: number;
  weightSaves: number;
  orchestratorBoosts: number;
  modelExports: number;
  mlSamples: number;
  mlpSamples: number;
  gbmSamples: number;
  hitRateEma: number;
  understandingScore: number;
  peakHitRate: number;
  weightRestores: number;
  stabilizeMode: boolean;
  lastUpdateAt: number;
  startedAt: number;
  live: boolean;
}

const DEFAULT: LearningState = {
  totalEvaluations: 0,
  totalLearningUpdates: 0,
  weightSaves: 0,
  orchestratorBoosts: 0,
  modelExports: 0,
  mlSamples: 0,
  mlpSamples: 0,
  gbmSamples: 0,
  hitRateEma: 0,
  understandingScore: 0,
  peakHitRate: 0,
  weightRestores: 0,
  stabilizeMode: false,
  lastUpdateAt: 0,
  startedAt: Date.now(),
  live: true,
};

export async function loadLearningState(): Promise<LearningState> {
  const s = await readJsonSafe<LearningState>(LEARNING_STATE_FILE);
  return s ? { ...DEFAULT, ...s } : { ...DEFAULT, startedAt: Date.now() };
}

export async function saveLearningState(state: LearningState): Promise<void> {
  await mkdir(dirname(LEARNING_STATE_FILE), { recursive: true });
  state.lastUpdateAt = Date.now();
  await writeJsonAtomic(LEARNING_STATE_FILE, state);
}

export function bumpUnderstanding(
  state: LearningState,
  hit: boolean,
  mlSamples: number,
): LearningState {
  const alpha = 0.08;
  state.hitRateEma = state.totalEvaluations === 0
    ? (hit ? 1 : 0)
    : Number((state.hitRateEma * (1 - alpha) + (hit ? 1 : 0) * alpha).toFixed(4));

  const sampleGrowth = Math.min(1, mlSamples / 5000);
  state.understandingScore = Number(
    Math.min(0.99, state.hitRateEma * 0.55 + sampleGrowth * 0.35 + Math.min(1, state.totalLearningUpdates / 200) * 0.1).toFixed(4),
  );
  state.mlSamples = mlSamples;
  return state;
}

export function learningFilesExist(): boolean {
  const dir = join(pkgRoot, "data", "learning");
  return (
    existsSync(join(dir, "strategy-weights.json")) ||
    existsSync(join(dir, "ml-weights.json"))
  );
}
