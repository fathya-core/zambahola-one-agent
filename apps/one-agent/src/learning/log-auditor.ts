import { open, readFile, stat, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LATEST_RUN_FILE, RECEIPTS_DIR } from "../storage/paths.js";
import { writeJsonAtomic } from "../storage/json-io.js";
import { computeHitBand } from "./hit-eval.js";
import { strategyHitsFromVotes } from "../prediction-engine/ensemble.js";
import { appendResearchLog, WEIGHTS_FILE, type StrategyWeights } from "./adaptive-weights.js";
import { flushJournal } from "./pattern-journal.js";
import type {
  Decision,
  Prediction,
  PredictionEvaluation,
  PredictionMeta,
  RunRecord,
} from "../types.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const AUDIT_JSON = join(pkgRoot, "data", "learning", "LOG-AUDIT-REPORT.json");
export const AUDIT_MD = join(pkgRoot, "data", "learning", "LOG-AUDIT-REPORT.md");
const ML_FILE = join(pkgRoot, "data", "learning", "ml-weights.json");
const MLP_FILE = join(pkgRoot, "data", "learning", "mlp-weights.json");
const RESEARCH_LOG = join(pkgRoot, "knowledge", "research-log.jsonl");

export interface AuditBucket {
  hits: number;
  total: number;
  hitRate: number;
}

export interface MissSample {
  predictionId: string;
  direction: string;
  regime?: string;
  gateReason?: string;
  confidence: number;
  priceChangePct: number;
  topVoters: string[];
  reasonAr: string;
}

export interface CleanupAction {
  kind: "strategy_weight" | "ml_reset" | "mlp_reset" | "receipt_prune" | "research_trim";
  detail: string;
  applied: boolean;
}

export interface LogAuditReport {
  auditedAt: number;
  source: string;
  dryRun: boolean;
  /** True when strategy-weights.json was updated (caller should reload engine weights). */
  weightsChanged: boolean;
  mlReset: boolean;
  mlpReset: boolean;
  summary: {
    predictions: number;
    evaluations: number;
    hits: number;
    misses: number;
    hitRate: number;
    directionalTotal: number;
    directionalHits: number;
    directionalHitRate: number;
    abstainCount: number;
    abstainRate: number;
  };
  byRegime: Record<string, AuditBucket>;
  byGateReason: Record<string, AuditBucket>;
  byDirection: Record<string, AuditBucket>;
  byStrategy: Record<string, AuditBucket>;
  byConfidenceBand: Record<string, AuditBucket>;
  topMisses: MissSample[];
  topHits: MissSample[];
  insightsAr: string[];
  cleanup: CleanupAction[];
}

export interface LogAuditOptions {
  runFile?: string;
  dryRun?: boolean;
  weakHitRate?: number;
  minStrategySamples?: number;
  maxReceipts?: number;
  maxResearchLines?: number;
}

function bump(map: Record<string, AuditBucket>, key: string, hit: boolean): void {
  if (!map[key]) map[key] = { hits: 0, total: 0, hitRate: 0 };
  const b = map[key];
  b.total += 1;
  if (hit) b.hits += 1;
  b.hitRate = Number((b.hits / b.total).toFixed(4));
}

function confBand(c: number): string {
  if (c < 0.55) return "low_<55";
  if (c < 0.65) return "mid_55-65";
  if (c < 0.75) return "good_65-75";
  return "high_75+";
}

function normalizeGate(reason?: string): string {
  if (!reason || reason === "n/a") return "none";
  const first = reason.split("|")[0]?.trim() ?? "";
  const prefix = first.split("_").slice(0, 2).join("_");
  return prefix.length > 2 ? prefix : first.slice(0, 24);
}

function buildMissReasonAr(
  pred: Prediction,
  changePct: number,
  hit: boolean,
): string {
  const meta = pred.meta;
  const regime = meta?.regime ?? "unknown";
  const gate = meta?.gateReason ?? "n/a";
  const dir = pred.direction;
  const sign = changePct >= 0 ? "+" : "";
  const outcome = hit ? "أصاب" : "أخطأ";
  const lean =
    gate.includes("learn") || gate.includes("lean")
      ? " (learn/lean)"
      : "";
  return `${outcome}: ${dir} @ ${regime} · تغيّر ${sign}${changePct.toFixed(3)}% · بوابة ${gate}${lean}`;
}

function dominantVoters(meta?: PredictionMeta, direction?: string): string[] {
  if (!meta?.strategyVotes || !direction) return [];
  return meta.strategyVotes
    .filter((v) => v.direction === direction)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((v) => `${v.strategyId}(${v.reason.slice(0, 20)})`);
}

function buildInsights(report: Omit<LogAuditReport, "insightsAr" | "cleanup">): string[] {
  const lines: string[] = [];
  const s = report.summary;

  const dirN = s.directionalTotal;
  lines.push(
    `📊 مراجعة السجل: ${s.evaluations} تقييم · hit شامل ${(s.hitRate * 100).toFixed(1)}% · اتجاهي ${(s.directionalHitRate * 100).toFixed(1)}% (${dirN} إشارة) · range ${(s.abstainRate * 100).toFixed(1)}%`,
  );

  if (s.abstainRate >= 0.85 && dirN < 8) {
    lines.push(
      "ℹ️ hit الشامل مرتفع لأن أغلب التنبؤات range والسعر هادئ — راقب directional hit فقط (هدف 58%+)",
    );
  }

  for (const [regime, b] of Object.entries(report.byRegime)) {
    if (b.total < 5) continue;
    const pct = (b.hitRate * 100).toFixed(1);
    if (b.hitRate < 0.4) {
      lines.push(`⚠️ نظام ${regime}: ضعيف ${pct}% (${b.hits}/${b.total})`);
    } else if (b.hitRate >= 0.58) {
      if (regime === "range" && dirN < 5) {
        lines.push(
          `ℹ️ نظام ${regime}: hit تسمية range ${pct}% (${b.hits}/${b.total}) — مو دقة اتجاهية`,
        );
      } else {
        lines.push(`✅ نظام ${regime}: قوي ${pct}% (${b.hits}/${b.total})`);
      }
    }
  }

  const weak = Object.entries(report.byStrategy)
    .filter(([, b]) => b.total >= 6 && b.hitRate < 0.38)
    .sort((a, b) => a[1].hitRate - b[1].hitRate)
    .slice(0, 5);
  for (const [sid, b] of weak) {
    lines.push(`📉 استراتيجية ${sid}: hit ${(b.hitRate * 100).toFixed(1)}% — مرشحة لتخفيف الوزن`);
  }

  const badGates = Object.entries(report.byGateReason)
    .filter(([k, b]) => k !== "none" && b.total >= 4 && b.hitRate < 0.35)
    .sort((a, b) => a[1].hitRate - b[1].hitRate)
    .slice(0, 4);
  for (const [gate, b] of badGates) {
    lines.push(`🚧 بوابة ${gate}: hit ${(b.hitRate * 100).toFixed(1)}% — راجع الفلتر`);
  }

  if (s.abstainRate < 0.35 && s.directionalHitRate < 0.45) {
    lines.push("🔴 امتناع منخفض + دقة اتجاهية ضعيفة — كثير إشارات ضعيفة تمر");
  }

  return lines.slice(0, 16);
}

async function parseRunLog(path: string): Promise<{
  predictions: Map<string, Prediction>;
  decisions: Map<string, Decision>;
  evaluations: PredictionEvaluation[];
}> {
  const predictions = new Map<string, Prediction>();
  const decisions = new Map<string, Decision>();
  const evaluations: PredictionEvaluation[] = [];

  if (!existsSync(path)) return { predictions, decisions, evaluations };

  const tailBytes = Number(process.env.ZAMBAHOLA_LOG_AUDIT_TAIL_BYTES ?? 3_000_000);
  let raw = "";
  try {
    const st = await stat(path);
    const readSize = Math.min(st.size, tailBytes);
    const offset = Math.max(0, st.size - readSize);
    const fh = await open(path, "r");
    const buf = Buffer.alloc(readSize);
    await fh.read(buf, 0, readSize, offset);
    await fh.close();
    raw = buf.toString("utf8");
    if (offset > 0) {
      const nl = raw.indexOf("\n");
      if (nl >= 0) raw = raw.slice(nl + 1);
    }
  } catch {
    raw = await readFile(path, "utf8");
  }

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as RunRecord;
      if (rec.type === "prediction") {
        const p = rec.payload as Prediction;
        predictions.set(p.predictionId, p);
      } else if (rec.type === "decision") {
        const d = rec.payload as Decision;
        decisions.set(d.predictionId, d);
      } else if (rec.type === "evaluation") {
        evaluations.push(rec.payload as PredictionEvaluation);
      }
    } catch {
      /* skip corrupt line */
    }
  }
  return { predictions, decisions, evaluations };
}

function hasBadNumbers(values: unknown): boolean {
  const walk = (v: unknown): boolean => {
    if (typeof v === "number") return !Number.isFinite(v);
    if (Array.isArray(v)) return v.some(walk);
    if (v && typeof v === "object") return Object.values(v).some(walk);
    return false;
  };
  return walk(values);
}

const ML_DEFAULT = [
  0, 0.4, 0.25, 0.15, -0.1, -0.2, 0.35, -0.12, 0.2, 0.28, 0.38, -0.06, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05,
];

async function sanitizeMlWeights(dryRun: boolean): Promise<CleanupAction[]> {
  const actions: CleanupAction[] = [];
  if (!existsSync(ML_FILE)) return actions;
  try {
    const data = JSON.parse(await readFile(ML_FILE, "utf8"));
    if (hasBadNumbers(data.weights)) {
      const detail = "ml-weights.json contained NaN/Inf — reset to defaults";
      if (!dryRun) {
        await mkdir(dirname(ML_FILE), { recursive: true });
        await writeFile(
          ML_FILE,
          JSON.stringify({ weights: ML_DEFAULT, samples: data.samples ?? 0, dim: ML_DEFAULT.length }, null, 2),
          "utf8",
        );
      }
      actions.push({ kind: "ml_reset", detail, applied: !dryRun });
    }
  } catch {
    /* */
  }
  return actions;
}

async function sanitizeMlpWeights(dryRun: boolean): Promise<CleanupAction[]> {
  const actions: CleanupAction[] = [];
  if (!existsSync(MLP_FILE)) return actions;
  try {
    const data = JSON.parse(await readFile(MLP_FILE, "utf8"));
    if (hasBadNumbers(data)) {
      const detail = "mlp-weights.json corrupted (NaN/Inf) — delete for cold restart";
      if (!dryRun) await unlink(MLP_FILE);
      actions.push({ kind: "mlp_reset", detail, applied: !dryRun });
    }
  } catch {
    /* */
  }
  return actions;
}

async function pruneReceipts(maxKeep: number, dryRun: boolean): Promise<CleanupAction[]> {
  const actions: CleanupAction[] = [];
  if (!existsSync(RECEIPTS_DIR)) return actions;

  const files = (await readdir(RECEIPTS_DIR))
    .filter((f) => f.startsWith("eval-pred-") && f.endsWith(".json"))
    .sort();

  if (files.length <= maxKeep) return actions;

  const toDelete = files.slice(0, files.length - maxKeep);
  if (!dryRun) {
    for (const f of toDelete) {
      await unlink(join(RECEIPTS_DIR, f));
    }
  }
  actions.push({
    kind: "receipt_prune",
    detail: `prune ${toDelete.length} old eval receipts (keep ${maxKeep})`,
    applied: !dryRun,
  });
  return actions;
}

async function trimResearchLog(maxLines: number, dryRun: boolean): Promise<CleanupAction[]> {
  const actions: CleanupAction[] = [];
  if (!existsSync(RESEARCH_LOG)) return actions;

  const raw = await readFile(RESEARCH_LOG, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length <= maxLines * 2) return actions;

  const keep = lines.slice(-maxLines);
  if (!dryRun) {
    await writeFile(RESEARCH_LOG, `${keep.join("\n")}\n`, "utf8");
  }
  actions.push({
    kind: "research_trim",
    detail: `trim research-log ${lines.length} → ${keep.length} lines`,
    applied: !dryRun,
  });
  return actions;
}

async function softenWeakStrategies(
  byStrategy: Record<string, AuditBucket>,
  opts: { weakHitRate: number; minSamples: number },
  dryRun: boolean,
): Promise<{ actions: CleanupAction[]; weightsChanged: boolean; weights?: StrategyWeights }> {
  const actions: CleanupAction[] = [];
  if (!existsSync(WEIGHTS_FILE)) return { actions, weightsChanged: false };

  let weights: StrategyWeights;
  try {
    weights = JSON.parse(await readFile(WEIGHTS_FILE, "utf8")) as StrategyWeights;
  } catch {
    return { actions, weightsChanged: false };
  }

  let changed = false;
  for (const [sid, b] of Object.entries(byStrategy)) {
    if (b.total < opts.minSamples || b.hitRate >= opts.weakHitRate) continue;
    const cur = weights[sid] ?? 1;
    const next = Number(Math.max(0.25, cur * 0.88).toFixed(4));
    if (next < cur) {
      weights[sid] = next;
      changed = true;
      actions.push({
        kind: "strategy_weight",
        detail: `${sid}: ${cur} → ${next} (hit ${(b.hitRate * 100).toFixed(1)}%, n=${b.total})`,
        applied: !dryRun,
      });
    }
  }

  if (changed && !dryRun) {
    await mkdir(dirname(WEIGHTS_FILE), { recursive: true });
    await writeFile(WEIGHTS_FILE, JSON.stringify(weights, null, 2), "utf8");
  }
  return { actions, weightsChanged: changed && !dryRun, weights: changed ? weights : undefined };
}

export async function runLogAudit(options: LogAuditOptions = {}): Promise<LogAuditReport> {
  const runFile = options.runFile ?? LATEST_RUN_FILE;
  const dryRun = options.dryRun !== false;
  const weakHitRate = options.weakHitRate ?? 0.38;
  const minStrategySamples = options.minStrategySamples ?? 6;
  const maxReceipts = options.maxReceipts ?? 250;
  const maxResearchLines = options.maxResearchLines ?? 8000;

  const { predictions, evaluations } = await parseRunLog(runFile);

  const byRegime: Record<string, AuditBucket> = {};
  const byGateReason: Record<string, AuditBucket> = {};
  const byDirection: Record<string, AuditBucket> = {};
  const byStrategy: Record<string, AuditBucket> = {};
  const byConfidenceBand: Record<string, AuditBucket> = {};
  const missSamples: MissSample[] = [];
  const hitSamples: MissSample[] = [];

  let hits = 0;
  let misses = 0;
  let directionalTotal = 0;
  let directionalHits = 0;
  let abstainCount = 0;

  for (const ev of evaluations) {
    const pred = predictions.get(ev.predictionId);
    const meta = pred?.meta;
    const change = ev.priceAtHorizon - ev.priceAtPrediction;
    const changePct = (change / ev.priceAtPrediction) * 100;
    const band = computeHitBand(ev.priceAtPrediction, meta?.features?.volatility as number | undefined);

    if (ev.predictionHit) hits += 1;
    else misses += 1;

    if (ev.direction === "range") abstainCount += 1;
    else {
      directionalTotal += 1;
      if (ev.predictionHit) directionalHits += 1;
    }

    const regime = meta?.regime ?? "unknown";
    const gate = normalizeGate(meta?.gateReason);
    bump(byRegime, regime, ev.predictionHit);
    bump(byGateReason, gate, ev.predictionHit);
    bump(byDirection, ev.direction, ev.predictionHit);
    if (pred) bump(byConfidenceBand, confBand(pred.confidence), ev.predictionHit);

    if (meta?.strategyVotes) {
      const stratHits = strategyHitsFromVotes(
        meta.strategyVotes,
        ev.direction,
        change,
        band,
      );
      for (const [sid, sh] of Object.entries(stratHits)) {
        bump(byStrategy, sid, sh);
      }
    }

    if (pred) {
      const sample: MissSample = {
        predictionId: ev.predictionId,
        direction: ev.direction,
        regime: meta?.regime,
        gateReason: meta?.gateReason,
        confidence: pred.confidence,
        priceChangePct: Number(changePct.toFixed(4)),
        topVoters: dominantVoters(meta, pred.direction),
        reasonAr: buildMissReasonAr(pred, changePct, ev.predictionHit),
      };
      if (ev.predictionHit) hitSamples.push(sample);
      else missSamples.push(sample);
    }
  }

  const total = evaluations.length;
  const summary = {
    predictions: predictions.size,
    evaluations: total,
    hits,
    misses,
    hitRate: total ? Number((hits / total).toFixed(4)) : 0,
    directionalTotal,
    directionalHits,
    directionalHitRate: directionalTotal
      ? Number((directionalHits / directionalTotal).toFixed(4))
      : 0,
    abstainCount,
    abstainRate: total ? Number((abstainCount / total).toFixed(4)) : 0,
  };

  const partial = {
    auditedAt: Date.now(),
    source: runFile,
    dryRun,
    summary,
    byRegime,
    byGateReason,
    byDirection,
    byStrategy,
    byConfidenceBand,
    topMisses: missSamples
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8),
    topHits: hitSamples
      .filter((s) => s.direction !== "range")
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5),
    insightsAr: [] as string[],
    cleanup: [] as CleanupAction[],
  };

  partial.insightsAr = buildInsights(partial);

  const cleanup: CleanupAction[] = [];
  const softened = await softenWeakStrategies(
    byStrategy,
    { weakHitRate, minSamples: minStrategySamples },
    dryRun,
  );
  cleanup.push(...softened.actions);
  const mlActions = await sanitizeMlWeights(dryRun);
  cleanup.push(...mlActions);
  const mlpActions = await sanitizeMlpWeights(dryRun);
  cleanup.push(...mlpActions);
  cleanup.push(...(await pruneReceipts(maxReceipts, dryRun)));
  cleanup.push(...(await trimResearchLog(maxResearchLines, dryRun)));

  partial.cleanup = cleanup;
  const weightsChanged = softened.weightsChanged;
  const mlReset = mlActions.some((a) => a.applied);
  const mlpReset = mlpActions.some((a) => a.applied);

  if (!dryRun) {
    await flushJournal();
    await appendResearchLog({
      event: "log_audit",
      hitRate: summary.hitRate,
      directionalHitRate: summary.directionalHitRate,
      evaluations: total,
      cleanupCount: cleanup.filter((c) => c.applied).length,
      insights: partial.insightsAr.slice(0, 5),
    });
  }

  const report: LogAuditReport = {
    ...partial,
    weightsChanged,
    mlReset,
    mlpReset,
  };
  await mkdir(dirname(AUDIT_JSON), { recursive: true });
  await writeJsonAtomic(AUDIT_JSON, report);

  const md = [
    "# مراجعة السجل — Log Audit",
    "",
    `الوقت: ${new Date(report.auditedAt).toISOString()}`,
    `المصدر: \`${runFile}\``,
    `الوضع: ${dryRun ? "معاينة (dry-run)" : "تنظيف مطبّق"}`,
    "",
    "## ملخص",
    "",
    `- تقييمات: ${summary.evaluations}`,
    `- Hit: ${(summary.hitRate * 100).toFixed(1)}%`,
    `- اتجاهي: ${(summary.directionalHitRate * 100).toFixed(1)}% (${summary.directionalHits}/${summary.directionalTotal})`,
    `- امتناع: ${(summary.abstainRate * 100).toFixed(1)}%`,
    "",
    "## تحليل (عربي)",
    "",
    ...report.insightsAr.map((l) => `- ${l}`),
    "",
    "## تنظيف",
    "",
    ...(cleanup.length
      ? cleanup.map((c) => `- [${c.kind}] ${c.detail}${c.applied ? " ✓" : " (معاينة)"}`)
      : ["- لا إجراءات مطلوبة"]),
    "",
  ].join("\n");
  await writeFile(AUDIT_MD, md, "utf8");

  return report;
}

export async function getLastLogAuditReport(): Promise<LogAuditReport | null> {
  const { readJsonSafe } = await import("../storage/json-io.js");
  return readJsonSafe<LogAuditReport>(AUDIT_JSON);
}
