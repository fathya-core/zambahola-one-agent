import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonSafe, writeJsonAtomic } from "../storage/json-io.js";
import type { PredictionDirection } from "../types.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const JSON_FILE = join(pkgRoot, "data", "learning", "pattern-journal.json");
const MD_FILE = join(pkgRoot, "data", "learning", "pattern-journal.md");

export interface PatternBucket {
  hits: number;
  total: number;
  misses: number;
  hitRate: number;
}

export interface PatternJournalData {
  updatedAt: number;
  totalEvaluations: number;
  byRegime: Record<string, PatternBucket>;
  byRegimeStrategy: Record<string, PatternBucket>;
  recentInsightsAr: string[];
}

const EMPTY: PatternJournalData = {
  updatedAt: 0,
  totalEvaluations: 0,
  byRegime: {},
  byRegimeStrategy: {},
  recentInsightsAr: [],
};

let data: PatternJournalData | null = null;

function bump(bucket: PatternBucket, hit: boolean): PatternBucket {
  bucket.total += 1;
  if (hit) bucket.hits += 1;
  else bucket.misses += 1;
  bucket.hitRate = Number((bucket.hits / bucket.total).toFixed(4));
  return bucket;
}

function getBucket(map: Record<string, PatternBucket>, key: string): PatternBucket {
  if (!map[key]) map[key] = { hits: 0, total: 0, misses: 0, hitRate: 0 };
  return map[key];
}

async function ensureLoaded(): Promise<PatternJournalData> {
  if (data) return data;
  data = (await readJsonSafe<PatternJournalData>(JSON_FILE)) ?? { ...EMPTY };
  return data;
}

export async function recordPatternEvaluation(ctx: {
  regime: string;
  direction: PredictionDirection;
  ensembleHit: boolean;
  strategyHits?: Record<string, boolean>;
  expertReason?: string;
  gateReason?: string;
}): Promise<void> {
  const d = await ensureLoaded();
  d.totalEvaluations += 1;

  bump(getBucket(d.byRegime, ctx.regime), ctx.ensembleHit);

  if (ctx.strategyHits) {
    for (const [sid, hit] of Object.entries(ctx.strategyHits)) {
      const key = `${ctx.regime}:${sid}`;
      bump(getBucket(d.byRegimeStrategy, key), hit);
    }
  }

  d.recentInsightsAr = buildInsightsAr(d);
  d.updatedAt = Date.now();

  const every = Number(process.env.ZAMBAHOLA_PATTERN_FLUSH_EVERY ?? 25);
  if (d.totalEvaluations % every === 0) {
    await flushJournal(d);
  }
}

function buildInsightsAr(d: PatternJournalData): string[] {
  const lines: string[] = [];

  for (const [regime, b] of Object.entries(d.byRegime)) {
    if (b.total < 8) continue;
    const pct = (b.hitRate * 100).toFixed(1);
    if (b.hitRate < 0.45) {
      lines.push(
        `⚠️ نظام ${regime}: دقة ضعيفة ${pct}% (${b.hits}/${b.total}) — راجع الامتناع أو الأوزان`,
      );
    } else if (b.hitRate >= 0.58) {
      lines.push(`✅ نظام ${regime}: أداء جيد ${pct}% (${b.hits}/${b.total})`);
    }
  }

  const weakStrategies = Object.entries(d.byRegimeStrategy)
    .filter(([, b]) => b.total >= 6 && b.hitRate < 0.4)
    .sort((a, b) => a[1].hitRate - b[1].hitRate)
    .slice(0, 5);

  for (const [key, b] of weakStrategies) {
    lines.push(
      `📉 ${key}: hit ${(b.hitRate * 100).toFixed(1)}% — فكّر تخفّف وزنها`,
    );
  }

  const strongStrategies = Object.entries(d.byRegimeStrategy)
    .filter(([, b]) => b.total >= 6 && b.hitRate >= 0.62)
    .sort((a, b) => b[1].hitRate - a[1].hitRate)
    .slice(0, 5);

  for (const [key, b] of strongStrategies) {
    lines.push(
      `📈 ${key}: hit ${(b.hitRate * 100).toFixed(1)}% — عزّزها`,
    );
  }

  return lines.slice(0, 12);
}

export async function flushJournal(d?: PatternJournalData): Promise<void> {
  const journal = d ?? (await ensureLoaded());
  journal.recentInsightsAr = buildInsightsAr(journal);
  journal.updatedAt = Date.now();
  await mkdir(dirname(JSON_FILE), { recursive: true });
  await writeJsonAtomic(JSON_FILE, journal);

  const md = [
    "# يومية الأنماط — Pattern Journal",
    "",
    `آخر تحديث: ${new Date(journal.updatedAt).toISOString()}`,
    `تقييمات: ${journal.totalEvaluations}`,
    "",
    "## تحليل (عربي)",
    "",
    ...(journal.recentInsightsAr.length
      ? journal.recentInsightsAr.map((l) => `- ${l}`)
      : ["- لا بيانات كافية بعد — انتظر 25+ تقييم"]),
    "",
    "## Regime",
    "",
    "```json",
    JSON.stringify(journal.byRegime, null, 2),
    "```",
    "",
  ].join("\n");

  await writeFile(MD_FILE, md, "utf8");
}

export async function getPatternJournal(): Promise<PatternJournalData> {
  const d = await ensureLoaded();
  d.recentInsightsAr = buildInsightsAr(d);
  return d;
}
