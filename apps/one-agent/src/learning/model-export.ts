import { readFile, writeFile, mkdir } from "node:fs/promises";
import { sanitizeJsonNumbers } from "./model-weight-health.js";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const LEARN_DIR = join(pkgRoot, "data", "learning");
const EXPORT_DIR = join(LEARN_DIR, "export");

const ARTIFACTS = [
  "ml-weights.json",
  "mlp-weights.json",
  "gbm-trees.json",
  "strategy-weights.json",
  "strategy-orchestrator.json",
  "calibration.json",
] as const;

export async function exportModelBundle(engineId: string): Promise<{
  path: string;
  files: string[];
}> {
  await mkdir(EXPORT_DIR, { recursive: true });
  const bundle: Record<string, unknown> = {
    engineId,
    exportedAt: new Date().toISOString(),
    version: "0.7",
    artifacts: {} as Record<string, unknown>,
  };

  const files: string[] = [];
  for (const name of ARTIFACTS) {
    const p = join(LEARN_DIR, name);
    if (!existsSync(p)) continue;
    const raw = await readFile(p, "utf8");
    (bundle.artifacts as Record<string, unknown>)[name] = sanitizeJsonNumbers(
      JSON.parse(raw),
    );
    files.push(name);
  }

  const out = join(EXPORT_DIR, `${engineId}-bundle.json`);
  await writeFile(out, JSON.stringify(bundle, null, 2), "utf8");
  return { path: out, files };
}
