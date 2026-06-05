import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "../storage/json-io.js";
import type { StrategyWeights } from "./adaptive-weights.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SNAP_DIR = join(pkgRoot, "data", "learning", "snapshots");
const BEST_WEIGHTS = join(SNAP_DIR, "best-strategy-weights.json");
const BEST_META = join(SNAP_DIR, "best-meta.json");

export interface WeightSnapshotMeta {
  hitRate: number;
  savedAt: number;
  evaluations: number;
}

export async function saveBestWeights(
  weights: StrategyWeights,
  hitRate: number,
  evaluations: number,
): Promise<void> {
  await mkdir(SNAP_DIR, { recursive: true });
  await writeJsonAtomic(BEST_WEIGHTS, weights);
  await writeJsonAtomic(BEST_META, {
    hitRate,
    savedAt: Date.now(),
    evaluations,
  } satisfies WeightSnapshotMeta);
}

export async function loadBestWeights(): Promise<{
  weights: StrategyWeights;
  meta: WeightSnapshotMeta;
} | null> {
  if (!existsSync(BEST_WEIGHTS) || !existsSync(BEST_META)) return null;
  try {
    const weights = JSON.parse(await readFile(BEST_WEIGHTS, "utf8")) as StrategyWeights;
    const meta = JSON.parse(await readFile(BEST_META, "utf8")) as WeightSnapshotMeta;
    return { weights, meta };
  } catch {
    return null;
  }
}

export async function restoreBestWeightsToFile(): Promise<WeightSnapshotMeta | null> {
  const best = await loadBestWeights();
  if (!best) return null;
  const out = join(pkgRoot, "data", "learning", "strategy-weights.json");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(best.weights, null, 2), "utf8");
  return best.meta;
}
