/**
 * Bundle .md research reports into ONE file for Cursor/AI review (before agent import).
 *
 * Usage:
 *   npm run bundle-reports
 *   npm run bundle-reports -- C:\Users\pc\Downloads
 *   npm run bundle-reports -- knowledge/user-reports
 */
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readReportFiles } from "../learning/report-files.js";
import {
  extractEntriesFromMarkdown,
  mergeImportEntries,
} from "../learning/md-research-extractor.js";
import type { ResearchImportsFile } from "../knowledge/research-import-loader.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_DIR = join(pkgRoot, "knowledge", "user-reports");
const OUT_MD = join(DEFAULT_DIR, "BUNDLE-FOR-REVIEW.md");
const OUT_JSON = join(DEFAULT_DIR, "BUNDLE-PREVIEW.json");

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
    console.error(`[bundle] folder not found: ${dir}`);
    process.exit(1);
  }

  const reports = await readReportFiles(dir);
  if (reports.length === 0) {
    console.error(`[bundle] no .md reports in: ${dir}`);
    process.exit(1);
  }

  const allEntries = [];
  const sections: string[] = [
    "# ZAMBAHOLA — حزمة تقارير للمراجعة",
    "",
    `> انسخ هذا الملف كامل أو ارفعه في محادثة Cursor قبل تعليم الوكيل.`,
    `> المجلد المصدر: \`${dir}\``,
    `> التاريخ: ${new Date().toISOString()}`,
    `> عدد الملفات: ${reports.length}`,
    "",
    "---",
    "",
  ];

  for (const r of reports) {
    const entries = extractEntriesFromMarkdown(r.text, r.name);
    allEntries.push(...entries);
    sections.push(`## 📄 ${r.name}`);
    sections.push("");
    sections.push(`<!-- source: ${r.path} -->`);
    sections.push("");
    sections.push(r.text.trim());
    sections.push("");
    sections.push("---");
    sections.push("");
  }

  const merged = mergeImportEntries(allEntries);
  const preview: ResearchImportsFile = { version: "1", entries: merged };

  sections.push("## 🤖 معاينة ما سيستورده الوكيل (لا تطبّق تلقائياً)");
  sections.push("");
  sections.push("```json");
  sections.push(JSON.stringify(preview, null, 2));
  sections.push("```");
  sections.push("");
  sections.push("## الخطوة التالية (بعد موافقة AI)");
  sections.push("");
  sections.push("```powershell");
  sections.push("npm run agent:import-md-reports");
  sections.push("npm run agent:omni-train");
  sections.push("```");

  await mkdir(DEFAULT_DIR, { recursive: true });
  await writeFile(OUT_MD, sections.join("\n"), "utf8");
  await writeFile(OUT_JSON, JSON.stringify(preview, null, 2), "utf8");

  console.log("[bundle] reports:", reports.map((r) => r.name).join(", "));
  console.log("[bundle] extracted entries:", merged.length);
  console.log("[bundle] FOR CURSOR CHAT →", OUT_MD);
  console.log("[bundle] preview JSON    →", OUT_JSON);
  console.log("\nارفع BUNDLE-FOR-REVIEW.md في المحادثة. بعد الموافقة:");
  console.log("  npm run agent:import-md-reports");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
