import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CATALOG_FILE = join(pkgRoot, "knowledge", "SKILLS-AND-LINKS.json");

export interface SkillSuggestion {
  kind: "skill" | "mcp" | "npm" | "doc";
  id: string;
  use: string;
  trigger?: string;
}

interface SkillsCatalog {
  skills?: Record<string, string[]>;
  mcpServers?: Record<string, { tools?: string[]; metaTools?: string[] }>;
  npmCommands?: Record<string, string[]>;
  docAr?: string;
  links?: Record<string, unknown>;
}

let catalogCache: SkillsCatalog | null = null;

const TASK_RULES: Array<{ match: RegExp; picks: SkillSuggestion[] }> = [
  {
    match: /بحث|research|paper|arxiv|deeplob|tlob/i,
    picks: [
      { kind: "skill", id: "tavily-research", use: "بحث عميق مع مصادر" },
      { kind: "skill", id: "paper_search", use: "أوراق HF MCP" },
      { kind: "npm", id: "agent:import-hf-research", use: "استيراد بحث للمشروع" },
    ],
  },
  {
    match: /خبر|news|سوق|market|search/i,
    picks: [
      { kind: "skill", id: "tavily-search", use: "بحث سريع" },
      { kind: "mcp", id: "zambahola_get_analyst", use: "تحليل عربي محلي" },
    ],
  },
  {
    match: /slack|sheet|github|تنبيه|alert|zapier/i,
    picks: [
      { kind: "skill", id: "zapier-setup", use: "إعداد Zapier MCP" },
      { kind: "mcp", id: "execute_zapier_write_action", use: "إرسال تنبيه" },
      { kind: "npm", id: "agent:push-telemetry", use: "رفع metrics للسحابة" },
    ],
  },
  {
    match: /train|تدريب|dl|deep|gpu|hf job/i,
    picks: [
      { kind: "skill", id: "hugging-face-model-trainer", use: "تدريب على HF Jobs" },
      { kind: "npm", id: "agent:dl-nightly", use: "إعادة تدريب DL ليلاً" },
      { kind: "npm", id: "agent:omni-train", use: "تدريب شامل محلي" },
    ],
  },
  {
    match: /hit|دقة|recover|تراجع|accuracy|abstain|gate|فلتر/i,
    picks: [
      { kind: "npm", id: "agent:phase4-hit-recover", use: "استعادة hit rate" },
      { kind: "npm", id: "agent:log-review:apply", use: "مراجع السجل + تنظيف" },
      { kind: "doc", id: "docs/ar/تراجع-الدقة-والحل.md", use: "دليل التراجع" },
    ],
  },
  {
    match: /سجل|log|audit|مراجعة|miss|خطأ/i,
    picks: [
      { kind: "npm", id: "agent:log-review", use: "مراجع السجل (معاينة)" },
      { kind: "mcp", id: "zambahola_get_log_audit", use: "قراءة تقرير المراجعة" },
      { kind: "npm", id: "agent:patterns", use: "يومية الأنماط الحية" },
    ],
  },
  {
    match: /telemetry|bridge|سحابة|cloud|remote/i,
    picks: [
      { kind: "npm", id: "agent:push-telemetry", use: "رفع للسحابة" },
      { kind: "mcp", id: "zambahola_get_telemetry", use: "لقطة bridge" },
      { kind: "mcp", id: "zambahola_queue_command", use: "أمر عن بُعد" },
    ],
  },
];

export async function loadSkillsCatalog(): Promise<SkillsCatalog> {
  if (catalogCache) return catalogCache;
  if (!existsSync(CATALOG_FILE)) {
    catalogCache = {};
    return catalogCache;
  }
  catalogCache = JSON.parse(await readFile(CATALOG_FILE, "utf8")) as SkillsCatalog;
  return catalogCache;
}

export function suggestSkillsForContext(
  task: string,
  opts?: { limit?: number },
): string[] {
  const limit = opts?.limit ?? 5;
  const out: string[] = [];
  for (const rule of TASK_RULES) {
    if (!rule.match.test(task)) continue;
    for (const p of rule.picks) {
      out.push(`${p.kind}:${p.id} — ${p.use}`);
    }
  }
  return out.slice(0, limit);
}

export async function getSkillsCatalogSummary(): Promise<{
  docAr: string;
  plugins: string[];
  mcpTools: string[];
  npmAudit: string[];
}> {
  const cat = await loadSkillsCatalog();
  const plugins = (cat as { cursorMarketplacePlugins?: { id: string }[] })
    .cursorMarketplacePlugins?.map((p) => p.id) ?? [];
  const mcpTools = Object.values(cat.mcpServers ?? {}).flatMap((s) => [
    ...(s.tools ?? []),
    ...(s.metaTools ?? []),
  ]);
  return {
    docAr: cat.docAr ?? "docs/ar/المهارات-والروابط.md",
    plugins,
    mcpTools: [...new Set(mcpTools)],
    npmAudit: cat.npmCommands?.audit ?? ["agent:log-review", "agent:log-review:apply"],
  };
}
