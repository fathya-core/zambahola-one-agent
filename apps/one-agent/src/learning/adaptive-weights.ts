import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

  if (!existsSync(WEIGHTS_FILE)) return base;
  try {
    const raw = JSON.parse(await readFile(WEIGHTS_FILE, "utf8")) as StrategyWeights;
    for (const id of strategyIds) {
      if (typeof raw[id] === "number" && raw[id] > 0) base[id] = raw[id];
    }
  } catch {
    /* use defaults */
  }
  return base;
}

export async function recordStrategyOutcome(
  strategyHits: Record<string, boolean>,
): Promise<StrategyWeights> {
  const ids = Object.keys(strategyHits);
  const weights = await loadStrategyWeights(ids);

  for (const [id, hit] of Object.entries(strategyHits)) {
    const w = weights[id] ?? DEFAULT_WEIGHT;
    weights[id] = Number(
      Math.max(0.25, Math.min(3, w * (hit ? 1.04 : 0.96))).toFixed(4),
    );
  }

  await mkdir(dirname(WEIGHTS_FILE), { recursive: true });
  await writeFile(WEIGHTS_FILE, JSON.stringify(weights, null, 2), "utf8");
  return weights;
}

export async function appendResearchLog(entry: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(RESEARCH_LOG), { recursive: true });
  const line = `${JSON.stringify({ ...entry, timestamp: Date.now() })}\n`;
  await appendFile(RESEARCH_LOG, line, "utf8");
}

export { WEIGHTS_FILE, RESEARCH_LOG };
