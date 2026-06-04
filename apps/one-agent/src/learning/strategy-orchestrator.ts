import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StrategyHitStats } from "../types.js";
import { loadStrategyWeights, type StrategyWeights } from "./adaptive-weights.js";
import { ALL_STRATEGIES } from "../prediction-engine/strategies/index.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ORCH_FILE = join(pkgRoot, "data", "learning", "strategy-orchestrator.json");

export async function boostTopStrategies(
  stats: StrategyHitStats[] | undefined,
  topN = 6,
): Promise<StrategyWeights> {
  const base = await loadStrategyWeights(ALL_STRATEGIES.map((s) => s.id));

  if (!stats?.length) return base;

  const ranked = [...stats]
    .filter((s) => s.total >= 5)
    .sort((a, b) => b.hitRate - a.hitRate)
    .slice(0, topN);

  for (const sid of Object.keys(base)) {
    base[sid] = Math.max(0.35, base[sid]! * 0.92);
  }
  for (const r of ranked) {
    base[r.strategyId] = Math.min(3.5, (base[r.strategyId] ?? 1) * (1.08 + r.hitRate * 0.25));
  }

  await mkdir(dirname(ORCH_FILE), { recursive: true });
  await writeFile(
    ORCH_FILE,
    JSON.stringify({ weights: base, top: ranked, updatedAt: Date.now() }, null, 2),
    "utf8",
  );
  return base;
}

export async function loadOrchestratorWeights(): Promise<StrategyWeights | null> {
  if (!existsSync(ORCH_FILE)) return null;
  try {
    const d = JSON.parse(await readFile(ORCH_FILE, "utf8")) as {
      weights: StrategyWeights;
    };
    return d.weights ?? null;
  } catch {
    return null;
  }
}
