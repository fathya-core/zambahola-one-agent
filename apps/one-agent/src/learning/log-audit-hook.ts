import type { PredictionEngine } from "../prediction-engine/index.js";
import { ALL_STRATEGIES } from "../prediction-engine/strategies/index.js";
import { loadStrategyWeights } from "./adaptive-weights.js";
import { runLogAudit, type LogAuditReport } from "./log-auditor.js";

const AUDIT_EVERY = Number(process.env.ZAMBAHOLA_LOG_AUDIT_EVERY ?? 50);
const AUDIT_MIN_EVALS = Number(process.env.ZAMBAHOLA_LOG_AUDIT_MIN_EVALS ?? 40);
const AUDIT_MIN_UPTIME_SEC = Number(process.env.ZAMBAHOLA_LOG_AUDIT_MIN_UPTIME_SEC ?? 180);
/** 1 = apply cleanup in-process; 0 = dry-run only while agent runs */
const AUDIT_APPLY_LIVE = process.env.ZAMBAHOLA_LOG_AUDIT_APPLY !== "0";

let lastReport: LogAuditReport | null = null;

export function getLiveLogAuditReport(): LogAuditReport | null {
  return lastReport;
}

/**
 * Second agent hook — runs inside the primary agent loop after evaluations.
 * Reloads strategy weights immediately when audit applies changes.
 */
export async function maybeRunLiveLogAudit(ctx: {
  engine: PredictionEngine;
  totalEvaluations: number;
  directionalRolling?: number;
  startedAt?: number;
}): Promise<LogAuditReport | null> {
  if (AUDIT_EVERY <= 0) return null;
  if (ctx.totalEvaluations < AUDIT_MIN_EVALS) return null;
  if (ctx.totalEvaluations % AUDIT_EVERY !== 0) return null;

  const uptimeSec = ctx.startedAt
    ? Math.floor((Date.now() - ctx.startedAt) / 1000)
    : 0;
  if (uptimeSec < AUDIT_MIN_UPTIME_SEC) return null;

  try {
    const apply =
      AUDIT_APPLY_LIVE &&
      (ctx.directionalRolling === undefined ||
        ctx.directionalRolling < 0.45 ||
        ctx.totalEvaluations % (AUDIT_EVERY * 2) === 0);

    const report = await runLogAudit({ dryRun: !apply });
    lastReport = report;

    if (report.weightsChanged) {
      const ids = ALL_STRATEGIES.map((s) => s.id);
      const weights = await loadStrategyWeights(ids);
      ctx.engine.setWeights(weights);
    }

    if (report.mlReset) await ctx.engine.ml.load();
    if (report.mlpReset) await ctx.engine.mlp.load();

    return report;
  } catch (err) {
    console.warn("[zambahola] log audit skipped:", err);
    return null;
  }
}

