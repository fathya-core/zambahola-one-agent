import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonSafe, writeJsonAtomic } from "../storage/json-io.js";
import type { PredictionEngine } from "../prediction-engine/index.js";
import { ALL_STRATEGIES } from "../prediction-engine/strategies/index.js";
import { loadStrategyWeights, appendResearchLog } from "./adaptive-weights.js";
import { runLogAudit, type LogAuditReport } from "./log-auditor.js";
import { flushJournal } from "./pattern-journal.js";
import { boostFromPatternJournal } from "./pattern-weight-boost.js";
import { restoreBestWeightsToFile, loadBestWeights } from "./weight-snapshot.js";
import { queueRemoteAction } from "../bridge/queue-command.js";
import type { SkillSuggestion } from "./skills-router.js";
import { isHitRecoverMode } from "./hit-recover-mode.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceRoot = join(pkgRoot, "../..");
export const SKILL_APPLIED_FILE = join(pkgRoot, "data", "learning", "last-skill-applied.json");

const AUTO_APPLY = process.env.ZAMBAHOLA_ANALYST_AUTO_APPLY !== "0";
const COOLDOWN_MS = Number(process.env.ZAMBAHOLA_ANALYST_APPLY_COOLDOWN_MS ?? 300_000);
/** 0 = queue only (safe); spawn can destabilize live agent on Windows */
const SPAWN_NPM = process.env.ZAMBAHOLA_ANALYST_SPAWN_NPM === "1";
const MIN_UPTIME_SEC = Number(process.env.ZAMBAHOLA_ANALYST_APPLY_MIN_UPTIME_SEC ?? 180);
const MIN_EVALS = Number(process.env.ZAMBAHOLA_ANALYST_APPLY_MIN_EVALS ?? 40);

let lastApplyAt = 0;
let lastApplied: AppliedSkillAction[] = [];
let persistedLoaded = false;

/** Fresh session — do not inherit 5min cooldown from disk */
export function resetAnalystSession(): void {
  lastApplyAt = 0;
}

async function ensurePersistedLoaded(): Promise<void> {
  if (persistedLoaded) return;
  persistedLoaded = true;
  const saved = await readJsonSafe<{ applied?: AppliedSkillAction[]; lastApplyAt?: number }>(
    SKILL_APPLIED_FILE,
  );
  if (saved?.applied?.length) {
    lastApplied = saved.applied;
    lastApplyAt = saved.lastApplyAt ?? 0;
  }
}

async function persistApplied(actions: AppliedSkillAction[]): Promise<void> {
  await mkdir(dirname(SKILL_APPLIED_FILE), { recursive: true });
  await writeJsonAtomic(SKILL_APPLIED_FILE, {
    applied: actions,
    lastApplyAt,
    updatedAt: Date.now(),
  });
}

export interface AppliedSkillAction {
  id: string;
  kind: SkillSuggestion["kind"];
  status: "applied" | "queued" | "spawned" | "skipped";
  detailAr: string;
  at: number;
}

export interface AnalystApplyContext {
  engine: PredictionEngine;
  report?: LogAuditReport | null;
  regime?: string;
  directionalRolling?: number;
  abstainRate?: number;
  totalEvaluations?: number;
  startedAt?: number;
  force?: boolean;
  /** Skip in-process log-review when audit just ran this eval */
  skipLogReviewApply?: boolean;
}

function pickActions(ctx: AnalystApplyContext): SkillSuggestion[] {
  const actions: SkillSuggestion[] = [];
  const r = ctx.report?.summary;
  const dirRaw = ctx.directionalRolling ?? r?.directionalHitRate;
  const dir = dirRaw == null || Number.isNaN(dirRaw) ? 0 : dirRaw;
  const abstain = ctx.abstainRate ?? r?.abstainRate ?? 0.5;
  const evals = ctx.totalEvaluations ?? r?.evaluations ?? 0;

  if (abstain >= 0.7 && evals >= MIN_EVALS) {
    actions.push({
      kind: "npm",
      id: "agent:log-review:apply",
      use: "امتناع مرتفع — مراجعة السجل وتنظيف الأوزان",
    });
    actions.push({
      kind: "npm",
      id: "agent:patterns",
      use: "تحديث يومية الأنماط بعد امتناع طويل",
    });
  }

  if (abstain >= 0.85 && evals >= MIN_EVALS + 10) {
    actions.push({
      kind: "npm",
      id: "agent:phase4-hit-recover",
      use: "إعادة معايرة البوابات — امتناع شبه كامل",
    });
  }

  if (abstain < 0.35 && dir < 0.5 && evals >= MIN_EVALS) {
    actions.push({
      kind: "npm",
      id: "agent:log-review:apply",
      use: "إشارات كثيرة ضعيفة — مراجعة السجل",
    });
    actions.push({
      kind: "npm",
      id: "agent:patterns",
      use: "تحديث يومية الأنماط بعد overtrading",
    });
  }

  if (dir < 0.4 && evals >= MIN_EVALS) {
    actions.push({
      kind: "npm",
      id: "agent:log-review:apply",
      use: "تنظيف أوزان ضعيفة من السجل",
    });
    actions.push({
      kind: "npm",
      id: "agent:patterns",
      use: "تحديث يومية الأنماط",
    });
    if (dir < 0.32 && !isHitRecoverMode()) {
      actions.push({
        kind: "npm",
        id: "agent:restore-weights",
        use: "استعادة أفضل snapshot للأوزان",
      });
    }
    if (ctx.regime) {
      actions.push({
        kind: "npm",
        id: "internal:pattern-boost",
        use: `تعزيز استراتيجيات قوية في نظام ${ctx.regime}`,
      });
    }
  }

  if (ctx.report?.mlReset || ctx.report?.mlpReset) {
    actions.push({
      kind: "npm",
      id: "agent:dl-nightly",
      use: "إعادة تدريب DL نظيف (خلفية)",
    });
  }

  if (abstain < 0.35 && dir < 0.45) {
    actions.push({
      kind: "npm",
      id: "agent:push-telemetry",
      use: "رفع telemetry للسحابة للمراجعة",
    });
  }

  if (dir < 0.38 && evals >= MIN_EVALS + 10) {
    actions.push({
      kind: "npm",
      id: "agent:import-hf-research",
      use: "استيراد بحث HF للمعرفة",
    });
  }

  const seen = new Set<string>();
  const unique = actions.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
  return unique.slice(0, 4);
}

function uptimeSec(ctx: AnalystApplyContext): number {
  if (!ctx.startedAt) return 0;
  return Math.floor((Date.now() - ctx.startedAt) / 1000);
}

async function execInProcess(
  id: string,
  ctx: AnalystApplyContext,
): Promise<AppliedSkillAction | null> {
  const at = Date.now();
  const engine = ctx.engine;

  switch (id) {
    case "agent:log-review:apply": {
      const report = await runLogAudit({ dryRun: false });
      if (report.weightsChanged) {
        const weights = await loadStrategyWeights(ALL_STRATEGIES.map((s) => s.id));
        engine.setWeights(weights);
      }
      if (report.mlReset) await engine.ml.load();
      if (report.mlpReset) await engine.mlp.load();
      return {
        id,
        kind: "npm",
        status: "applied",
        detailAr: `مراجع السجل طُبّق — hit ${(report.summary.directionalHitRate * 100).toFixed(1)}%`,
        at,
      };
    }
    case "agent:patterns": {
      await flushJournal();
      return {
        id,
        kind: "npm",
        status: "applied",
        detailAr: "يومية الأنماط حُدّثت على القرص",
        at,
      };
    }
    case "agent:restore-weights": {
      const best = await loadBestWeights();
      if (!best) {
        return {
          id,
          kind: "npm",
          status: "skipped",
          detailAr: "لا snapshot محفوظ — تخطّي",
          at,
        };
      }
      await restoreBestWeightsToFile();
      engine.setWeights(best.weights);
      return {
        id,
        kind: "npm",
        status: "applied",
        detailAr: `استُعيدت أوزان hit ${(best.meta.hitRate * 100).toFixed(1)}%`,
        at,
      };
    }
    case "internal:pattern-boost": {
      const regime = ctx.regime ?? "range";
      const base = await loadStrategyWeights(ALL_STRATEGIES.map((s) => s.id));
      const boosted = await boostFromPatternJournal(regime, base);
      engine.setWeights(boosted);
      return {
        id,
        kind: "npm",
        status: "applied",
        detailAr: `تعزيز أنماط نظام ${regime}`,
        at,
      };
    }
    default:
      return null;
  }
}

const REMOTE_ACTIONS: Record<string, string> = {
  "agent:dl-nightly": "dl-nightly",
  "agent:import-hf-research": "import-hf-research",
  "agent:push-telemetry": "push-telemetry",
  "agent:phase4-hit-recover": "phase4-hit-recover",
  "agent:log-review": "log-review",
};

function spawnNpmAgent(action: string): boolean {
  if (!SPAWN_NPM) return false;
  const mapped = REMOTE_ACTIONS[action] ?? action.replace(/^agent:/, "");
  try {
    const isWin = process.platform === "win32";
    const child = spawn(isWin ? "npm.cmd" : "npm", ["run", `agent:${mapped}`], {
      cwd: workspaceRoot,
      detached: true,
      stdio: "ignore",
      shell: isWin,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function execQueuedOrSpawn(
  id: string,
): Promise<AppliedSkillAction> {
  const at = Date.now();
  const mapped = REMOTE_ACTIONS[id];
  if (!mapped) {
    return {
      id,
      kind: "npm",
      status: "skipped",
      detailAr: "أمر غير معروف",
      at,
    };
  }
  await queueRemoteAction(mapped, {}, "analyst_auto");
  const spawned = spawnNpmAgent(id);
  return {
    id,
    kind: "npm",
    status: spawned ? "spawned" : "queued",
    detailAr: spawned
      ? `شُغّل ${id} في الخلفية`
      : `أُضيف ${id} لطابور REMOTE-COMMANDS (شغّل remote-watcher)`,
    at,
  };
}

const IN_PROCESS = new Set([
  "agent:log-review:apply",
  "agent:patterns",
  "agent:restore-weights",
  "internal:pattern-boost",
]);

export function getLastAppliedSkillActions(): AppliedSkillAction[] {
  void ensurePersistedLoaded();
  return lastApplied;
}

export async function loadPersistedSkillActions(): Promise<AppliedSkillAction[]> {
  await ensurePersistedLoaded();
  return lastApplied;
}

/** Analyst picks skills and applies them (not suggestion-only). */
export async function applyAnalystSkillActions(
  ctx: AnalystApplyContext,
): Promise<AppliedSkillAction[]> {
  await ensurePersistedLoaded();
  if (!AUTO_APPLY && !ctx.force) return [];

  const now = Date.now();
  if (!ctx.force && now - lastApplyAt < COOLDOWN_MS) {
    return lastApplied;
  }

  if (!ctx.force && uptimeSec(ctx) < MIN_UPTIME_SEC) {
    return lastApplied;
  }

  const picks = pickActions(ctx);
  if (!picks.length) return [];

  const applied: AppliedSkillAction[] = [];
  for (const pick of picks) {
    try {
      if (ctx.skipLogReviewApply && pick.id === "agent:log-review:apply") continue;
      let result: AppliedSkillAction | null = null;
      if (IN_PROCESS.has(pick.id)) {
        result = await execInProcess(pick.id, ctx);
      } else if (pick.id.startsWith("agent:")) {
        result = await execQueuedOrSpawn(pick.id);
      }
      if (result) applied.push(result);
    } catch (err) {
      applied.push({
        id: pick.id,
        kind: pick.kind,
        status: "skipped",
        detailAr: `فشل آمن — ${String(err).slice(0, 120)}`,
        at: Date.now(),
      });
    }
  }

  if (applied.length) {
    lastApplyAt = now;
    lastApplied = applied;
    try {
      await persistApplied(applied);
      await appendResearchLog({
        event: "analyst_skill_apply",
        applied: applied.map((a) => ({ id: a.id, status: a.status, detail: a.detailAr })),
        directionalRolling: ctx.directionalRolling,
        regime: ctx.regime,
      });
    } catch {
      /* never crash live agent on log write */
    }
  }

  return applied;
}

export function formatAppliedActionsAr(actions: AppliedSkillAction[]): string[] {
  return actions.map((a) => {
    const icon =
      a.status === "applied" ? "✅" : a.status === "queued" ? "📋" : a.status === "spawned" ? "🚀" : "⏭";
    return `${icon} ${a.id}: ${a.detailAr}`;
  });
}
