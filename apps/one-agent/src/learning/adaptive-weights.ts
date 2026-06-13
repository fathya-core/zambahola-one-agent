import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonSafe, writeJsonAtomic } from "../storage/json-io.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WEIGHTS_FILE = join(pkgRoot, "data", "learning", "strategy-weights.json");
const RESEARCH_LOG = join(pkgRoot, "knowledge", "research-log.jsonl");

const DEFAULT_WEIGHT = 1;

export type StrategyWeights = Record<string, number>;

export async function loadStrategyWeights(
  strategyIds: string[],
): Promise<StrategyWeights> {
  const base: StrategyWeights = {};
  for (const id of strategyIds) base[id] = DEFAULT_WEIGHT;

  const raw = await readJsonSafe<StrategyWeights>(WEIGHTS_FILE);
  if (raw) {
    for (const id of strategyIds) {
      const v = raw[id];
      if (typeof v === "number" && v > 0) base[id] = v;
    }
  }
  return base;
}

export async function recordStrategyOutcome(
  strategyHits: Record<string, boolean>,
  multipliers?: { hit: number; miss: number },
): Promise<StrategyWeights> {
  const ids = Object.keys(strategyHits);
  const weights = await loadStrategyWeights(ids);
  const hitM = multipliers?.hit ?? 1.025;
  const missM = multipliers?.miss ?? 0.975;

  for (const [id, hit] of Object.entries(strategyHits)) {
    const w = weights[id] ?? DEFAULT_WEIGHT;
    weights[id] = Number(
      Math.max(0.25, Math.min(3, w * (hit ? hitM : missM))).toFixed(4),
    );
  }

  await writeJsonAtomic(WEIGHTS_FILE, weights);
  return weights;
}

export async function appendResearchLog(entry: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(RESEARCH_LOG), { recursive: true });
  const line = `${JSON.stringify({ ...entry, timestamp: Date.now() })}\n`;
  await appendFile(RESEARCH_LOG, line, "utf8");
}

export { WEIGHTS_FILE, RESEARCH_LOG };
