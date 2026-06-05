/**
 * Import Perplexity (or manual) research into research-imports.json
 * Usage:
 *   npm run research-import -- path/to/paste.json
 *   cat paste.json | npm run research-import
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  saveResearchImports,
  researchImportsPaths,
  type ResearchImportsFile,
} from "../knowledge/research-import-loader.js";
import { applyResearchImportsToDisk } from "../knowledge/research-import-loader.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = join(pkgRoot, "../..");

function resolveInputPath(arg: string): string {
  if (existsSync(arg)) return arg;
  const candidates = [
    join(process.cwd(), arg),
    join(repoRoot, arg),
    join(pkgRoot, arg),
    join(pkgRoot, "knowledge", arg),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return arg;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  let raw: string;

  if (arg && arg !== "-") {
    raw = readFileSync(resolveInputPath(arg), "utf8");
  } else if (!process.stdin.isTTY) {
    raw = await readStdin();
  } else {
    const paths = researchImportsPaths();
    console.log(`Usage: research-import <file.json>
Or pipe JSON to stdin.

Example template: ${paths.example}
Writes to: ${paths.data}`);
    process.exit(1);
  }

  const parsed = JSON.parse(raw) as ResearchImportsFile;
  if (!parsed.entries?.length) {
    throw new Error("JSON must have entries[] array");
  }

  const target = await saveResearchImports(parsed, true);
  const applied = await applyResearchImportsToDisk();
  console.log("[zambahola] research-import saved:", target);
  console.log("[zambahola] applied:", applied.applied, "entries:", applied.entries);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
