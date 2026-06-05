import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StrategyWeights } from "../learning/adaptive-weights.js";
import { writeJsonAtomic } from "../storage/json-io.js";
import { WEIGHTS_FILE } from "../learning/adaptive-weights.js";
import { appendResearchLog } from "../learning/adaptive-weights.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const EXAMPLE = join(pkgRoot, "knowledge", "research-imports.example.json");
const DATA_FILE = join(pkgRoot, "data", "learning", "research-imports.json");
const KNOWLEDGE_FILE = join(pkgRoot, "knowledge", "research-imports.json");

export interface ResearchRule {
  id: string;
  regime?: string;
  blockStrategies?: string[];
  unlessAgreement?: number;
  weightBoost?: Record<string, number>;
}

export interface ResearchImportEntry {
  /** perplexity | manual recommended; manus kept for old paste files only */
  source: "perplexity" | "manual" | "manus";
  importedAt?: string;
  query?: string;
  topics?: string[];
  weightAdjustments?: Record<string, number>;
  rules?: ResearchRule[];
  minDirectionalHitTarget?: number;
  notes?: string;
}

export interface ResearchImportsFile {
  version: string;
  entries: ResearchImportEntry[];
}

export function researchImportsPaths(): { data: string; knowledge: string; example: string } {
  return { data: DATA_FILE, knowledge: KNOWLEDGE_FILE, example: EXAMPLE };
}

export async function loadResearchImports(): Promise<ResearchImportsFile | null> {
  const path = existsSync(DATA_FILE)
    ? DATA_FILE
    : existsSync(KNOWLEDGE_FILE)
      ? KNOWLEDGE_FILE
      : null;
  if (!path) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as ResearchImportsFile;
  } catch {
    return null;
  }
}

/** Merge all imported weight adjustments into base weights (cap 2.5) */
export function mergeResearchWeights(
  base: StrategyWeights,
  imports: ResearchImportsFile,
): StrategyWeights {
  const out = { ...base };
  for (const entry of imports.entries) {
    if (!entry.weightAdjustments) continue;
    for (const [id, mult] of Object.entries(entry.weightAdjustments)) {
      const cur = out[id] ?? 1;
      out[id] = Number(Math.min(2.5, Math.max(0.4, cur * mult)).toFixed(4));
    }
  }
  return out;
}

export async function applyResearchImportsToDisk(): Promise<{
  applied: boolean;
  entries: number;
  weights?: StrategyWeights;
}> {
  const imports = await loadResearchImports();
  if (!imports?.entries?.length) {
    return { applied: false, entries: 0 };
  }

  let base: StrategyWeights = {};
  if (existsSync(WEIGHTS_FILE)) {
    try {
      base = JSON.parse(await readFile(WEIGHTS_FILE, "utf8")) as StrategyWeights;
    } catch {
      /* */
    }
  }

  const merged = mergeResearchWeights(base, imports);
  await writeJsonAtomic(WEIGHTS_FILE, merged);

  await appendResearchLog({
    event: "research_imports_applied",
    entries: imports.entries.length,
    sources: imports.entries.map((e) => e.source),
    topics: imports.entries.flatMap((e) => e.topics ?? []),
  });

  return { applied: true, entries: imports.entries.length, weights: merged };
}

export async function saveResearchImports(
  data: ResearchImportsFile,
  toDataDir = true,
): Promise<string> {
  const target = toDataDir ? DATA_FILE : KNOWLEDGE_FILE;
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(target), { recursive: true });
  await writeJsonAtomic(target, data);
  return target;
}
