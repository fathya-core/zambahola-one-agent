import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StrategyWeights } from "../learning/adaptive-weights.js";
import { writeJsonAtomic } from "../storage/json-io.js";
import { WEIGHTS_FILE } from "../learning/adaptive-weights.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PRESET = join(pkgRoot, "knowledge", "expert-weights-preset.json");
const CURRICULUM = join(pkgRoot, "knowledge", "expert-curriculum.json");

export interface ExpertCurriculum {
  phases: Array<{
    id: string;
    nameAr: string;
    strategiesFocus: string[];
    trainBars: number;
    liveCycles: number;
    minHitRate: number;
    sources: string[];
  }>;
  strategyTiers: Record<string, string[]>;
  expertRules: unknown[];
}

export async function loadExpertCurriculum(): Promise<ExpertCurriculum | null> {
  if (!existsSync(CURRICULUM)) return null;
  return JSON.parse(await readFile(CURRICULUM, "utf8")) as ExpertCurriculum;
}

export async function loadExpertWeightPreset(): Promise<StrategyWeights | null> {
  if (!existsSync(PRESET)) return null;
  const data = JSON.parse(await readFile(PRESET, "utf8")) as { weights: StrategyWeights };
  return data.weights ?? null;
}

/** Merge expert priors with learned weights (expert 40% / learned 60%) */
export function mergeExpertWithLearned(
  expert: StrategyWeights,
  learned: StrategyWeights,
): StrategyWeights {
  const out: StrategyWeights = {};
  const ids = new Set([...Object.keys(expert), ...Object.keys(learned)]);
  for (const id of ids) {
    const e = expert[id] ?? 1;
    const l = learned[id] ?? 1;
    out[id] = Number((e * 0.4 + l * 0.6).toFixed(4));
  }
  return out;
}

export async function applyExpertPresetToDisk(): Promise<StrategyWeights | null> {
  const preset = await loadExpertWeightPreset();
  if (!preset) return null;
  let merged = preset;
  if (existsSync(WEIGHTS_FILE)) {
    try {
      const learned = JSON.parse(
        await readFile(WEIGHTS_FILE, "utf8"),
      ) as StrategyWeights;
      merged = mergeExpertWithLearned(preset, learned);
    } catch {
      /* */
    }
  }
  await writeJsonAtomic(WEIGHTS_FILE, merged);
  return merged;
}

export function getStrategyTier(
  strategyId: string,
  tiers: Record<string, string[]>,
): string | null {
  for (const [tier, ids] of Object.entries(tiers)) {
    if (ids.includes(strategyId)) return tier;
  }
  return null;
}
