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
  type ResearchImportEntry,
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

/** Map Perplexity verbose rules → simple expert rules the agent understands */
function simplifyPerplexityRules(rules: unknown[] | undefined) {
  if (!Array.isArray(rules)) return undefined;
  const out: NonNullable<ResearchImportEntry["rules"]> = [];
  for (const r of rules) {
    if (!r || typeof r !== "object") continue;
    const rule = r as Record<string, unknown>;
    const target = rule.target_strategy as string | undefined;
    const action = rule.action as string | undefined;
    const condition = rule.condition as Record<string, unknown> | undefined;
    const primary = condition?.primary_signal as string | undefined;
    if (
      target === "mean_reversion" &&
      (action === "abstain" || action === "downweight") &&
      (primary === "trend_up" || primary === "trend_down")
    ) {
      out.push({
        id: String(rule.id ?? "perplexity_rule"),
        regime: primary === "trend_down" ? "trend_down" : "trend_up",
        blockStrategies: ["mean_reversion"],
        unlessAgreement: Number(rule.meta_label_threshold ?? 0.65),
      });
    }
  }
  return out.length ? out : undefined;
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

  const parsed = JSON.parse(raw) as ResearchImportsFile | ResearchImportEntry & {
    weightAdjustments?: Record<string, number>;
  };

  let file: ResearchImportsFile;
  if ("entries" in parsed && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
    file = parsed as ResearchImportsFile;
  } else if (
    "weightAdjustments" in parsed &&
    parsed.weightAdjustments &&
    typeof parsed.weightAdjustments === "object"
  ) {
    const rawPaste = parsed as ResearchImportEntry & {
      weightAdjustments: Record<string, number>;
      rules?: unknown[];
    };
    file = {
      version: "1",
      entries: [
        {
          source: "perplexity",
          importedAt: new Date().toISOString().slice(0, 10),
          query: rawPaste.query ?? "Perplexity paste",
          weightAdjustments: rawPaste.weightAdjustments,
          minDirectionalHitTarget: rawPaste.minDirectionalHitTarget,
          rules: simplifyPerplexityRules(rawPaste.rules),
          notes:
            rawPaste.notes ??
            "Auto-wrapped from raw Perplexity JSON (weightAdjustments applied; complex rules simplified).",
        },
      ],
    };
    console.log("[zambahola] auto-wrapped raw Perplexity JSON → entries[1]");
  } else {
    throw new Error("JSON needs entries[] or top-level weightAdjustments (Perplexity paste)");
  }

  const target = await saveResearchImports(file, true);
  const applied = await applyResearchImportsToDisk();
  console.log("[zambahola] research-import saved:", target);
  console.log("[zambahola] applied:", applied.applied, "entries:", applied.entries);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
