/**
 * Import Perplexity / research .md reports from a folder into research-imports.json
 *
 * Usage:
 *   npm run import-md-reports
 *   npm run import-md-reports -- C:\path\to\folder
 *   npm run import-md-reports -- knowledge/user-reports
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { listReportMdFiles } from "../learning/report-files.js";
import { fileURLToPath } from "node:url";
import {
  saveResearchImports,
  applyResearchImportsToDisk,
  type ResearchImportsFile,
} from "../knowledge/research-import-loader.js";
import {
  extractEntriesFromMarkdown,
  mergeImportEntries,
} from "../learning/md-research-extractor.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_DIR = join(pkgRoot, "knowledge", "user-reports");

function resolveDir(arg: string | undefined): string {
  if (!arg) return DEFAULT_DIR;
  if (existsSync(arg)) return arg;
  const fromPkg = join(pkgRoot, arg);
  if (existsSync(fromPkg)) return fromPkg;
  return arg;
}

async function main(): Promise<void> {
  const dir = resolveDir(process.argv[2]);
  if (!existsSync(dir)) {
    console.error(`[zambahola] folder not found: ${dir}`);
    console.error(`Create it and copy your .md reports there, e.g.:`);
    console.error(`  ${DEFAULT_DIR}`);
    process.exit(1);
  }

  const files = (await listReportMdFiles(dir)).filter(
    (f) => f.toLowerCase() !== "bundle-for-review.md",
  );
  if (files.length === 0) {
    console.error(`[zambahola] no .md files in: ${dir}`);
    process.exit(1);
  }

  const allEntries = [];
  for (const f of files) {
    const text = await readFile(join(dir, f), "utf8");
    const entries = extractEntriesFromMarkdown(text, f);
    console.log(`[import-md] ${f} → ${entries.length} entries`);
    for (const e of entries) {
      const n = Object.keys(e.weightAdjustments ?? {}).length;
      console.log(
        `  - weights: ${n} minDir: ${e.minDirectionalHitTarget ?? "—"}`,
      );
    }
    allEntries.push(...entries);
  }

  const merged = mergeImportEntries(allEntries);
  if (merged.length === 0) {
    console.error(
      "[zambahola] no JSON blocks or strategy weights found in reports.",
    );
    console.error("Tip: ensure reports contain ```json with weightAdjustments");
    process.exit(1);
  }

  const file: ResearchImportsFile = { version: "1", entries: merged };
  const target = await saveResearchImports(file, true);
  const applied = await applyResearchImportsToDisk();

  console.log("\n[zambahola] saved:", target);
  console.log("[zambahola] entries:", merged.length, "applied:", applied.applied);
  console.log("\nNext: npm run agent:omni-train");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
