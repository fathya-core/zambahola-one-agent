import type { PredictionEngine } from "../prediction-engine/index.js";
import type { StrategyHitStats } from "../types.js";
import { boostTopStrategies } from "./strategy-orchestrator.js";
import { appendResearchLog } from "./adaptive-weights.js";
import { exportModelBundle } from "./model-export.js";
import {
  bumpUnderstanding,
  loadLearningState,
  saveLearningState,
  type LearningState,
} from "./learning-state.js";
import {
  recordHit,
  shouldSkipOrchestratorBoost,
  maybeSnapshotOrRestore,
} from "./hit-rate-guard.js";
import {
  isIntensiveLearn,
  orchestratorMinRolling,
} from "./intensive-learn.js";
import { boostFromPatternJournal } from "./pattern-weight-boost.js";
import { updateRecoveryMetrics } from "./recovery-mode.js";
import { updateHitRecoverRolling } from "./hit-recover-mode.js";
import { loadStrategyWeights } from "./adaptive-weights.js";
import { ALL_STRATEGIES } from "../prediction-engine/strategies/index.js";
import { maybeRunLiveLogAudit } from "./log-audit-hook.js";
import { applyAnalystSkillActions, resetAnalystSession } from "./analyst-skill-apply.js";

const WEIGHT_EVERY = Number(
  process.env.ZAMBAHOLA_LIVE_WEIGHT_EVERY ?? (isIntensiveLearn() ? 3 : 5),
);
const ORCH_EVERY = Number(
  process.env.ZAMBAHOLA_LIVE_ORCH_EVERY ?? (isIntensiveLearn() ? 6 : 12),
);
const PATTERN_BOOST_EVERY = Number(process.env.ZAMBAHOLA_PATTERN_BOOST_EVERY ?? 8);
const EXPORT_EVERY = Number(process.env.ZAMBAHOLA_LIVE_EXPORT_EVERY ?? 40);
const ANALYST_APPLY_EVERY = Number(process.env.ZAMBAHOLA_ANALYST_APPLY_EVERY ?? 50);
const ANALYST_APPLY_MIN_EVALS = Number(process.env.ZAMBAHOLA_ANALYST_APPLY_MIN_EVALS ?? 40);

let statePromise: Promise<LearningState> | null = null;
let dualAgentChain = Promise.resolve();
const enqueuedDualAt = new Set<number>();

async function patchLearningState(patch: Partial<LearningState>): Promise<LearningState> {
  const state = await loadLearningState();
  Object.assign(state, patch);
  await saveLearningState(state);
  statePromise = Promise.resolve(state);
  return state;
}

interface DualAgentJob {
  engine: PredictionEngine;
  sessionEvaluations: number;
  sessionStartedAt: number;
  directionalRolling: number;
  regime?: string;
  scheduleAudit: boolean;
  scheduleAnalyst: boolean;
}

function enqueueDualAgent(job: DualAgentJob): void {
  dualAgentChain = dualAgentChain
    .then(() => runDualAgentJob(job))
    .catch((err) => {
      console.warn("[zambahola] background dual-agent failed:", err);
    });
}

async function runDualAgentJob(job: DualAgentJob): Promise<void> {
  let auditReport: Awaited<ReturnType<typeof maybeRunLiveLogAudit>> = null;
  const patch: Partial<LearningState> = {};

  if (job.scheduleAudit) {
    try {
      auditReport = await maybeRunLiveLogAudit({
        engine: job.engine,
        sessionEvaluations: job.sessionEvaluations,
        directionalRolling: job.directionalRolling,
        sessionStartedAt: job.sessionStartedAt,
      });
      if (auditReport) {
        const cur = await loadLearningState();
        patch.logAudits = (cur.logAudits ?? 0) + 1;
        patch.sessionLogAudits = (cur.sessionLogAudits ?? 0) + 1;
        patch.lastLogAuditAt = auditReport.auditedAt;
        patch.lastAuditSessionEval = job.sessionEvaluations;
        patch.totalLearningUpdates = (cur.totalLearningUpdates ?? 0) + 1;
        await appendResearchLog({
          event: "live_log_audit",
          evaluations: cur.totalEvaluations,
          sessionEvaluations: job.sessionEvaluations,
          dryRun: auditReport.dryRun,
          hitRate: auditReport.summary.hitRate,
          directionalHitRate: auditReport.summary.directionalHitRate,
          weightsChanged: auditReport.weightsChanged,
          insights: auditReport.insightsAr.slice(0, 4),
          background: true,
        });
      }
    } catch (err) {
      console.warn("[zambahola] background log audit failed:", err);
    }
  }

  if (job.scheduleAnalyst) {
    try {
      const skillApplied = await applyAnalystSkillActions({
        engine: job.engine,
        report: auditReport,
        regime: job.regime,
        directionalRolling: job.directionalRolling,
        abstainRate: auditReport?.summary.abstainRate,
        totalEvaluations: job.sessionEvaluations,
        startedAt: job.sessionStartedAt,
        skipLogReviewApply: auditReport !== null,
      });
      if (skillApplied.length) {
        const cur = await loadLearningState();
        patch.sessionSkillApplies = (cur.sessionSkillApplies ?? 0) + 1;
        patch.lastAnalystSessionEval = job.sessionEvaluations;
        patch.totalLearningUpdates =
          (patch.totalLearningUpdates ?? cur.totalLearningUpdates ?? 0) + 1;
      }
    } catch (err) {
      console.warn("[zambahola] background analyst apply failed:", err);
    }
  }

  if (Object.keys(patch).length > 0) {
    await patchLearningState(patch);
  }
}

async function getState(): Promise<LearningState> {
  if (!statePromise) statePromise = loadLearningState();
  return statePromise;
}

/** Reset session counters when primary agent starts — keeps dual-agent schedule in sync with dashboard uptime */
export async function beginLiveLearningSession(agentStartedAt: number): Promise<LearningState> {
  const state = await loadLearningState();
  state.sessionEvaluations = 0;
  state.sessionLogAudits = 0;
  state.sessionSkillApplies = 0;
  state.sessionStartedAt = agentStartedAt;
  state.lastAuditSessionEval = 0;
  state.lastAnalystSessionEval = 0;
  enqueuedDualAt.clear();
  resetAnalystSession();
  await saveLearningState(state);
  statePromise = Promise.resolve(state);
  return state;
}

export function buildDualAgentStatus(state: LearningState, runtime?: {
  directionalRolling?: number;
  abstainRate?: number;
}): Record<string, unknown> {
  const auditEvery = Number(process.env.ZAMBAHOLA_LOG_AUDIT_EVERY ?? 50);
  const auditMin = Number(process.env.ZAMBAHOLA_LOG_AUDIT_MIN_EVALS ?? 40);
  const auditMinUptime = Number(process.env.ZAMBAHOLA_LOG_AUDIT_MIN_UPTIME_SEC ?? 180);
  const sess = state.sessionEvaluations ?? 0;
  const uptimeSec = state.sessionStartedAt
    ? Math.floor((Date.now() - state.sessionStartedAt) / 1000)
    : 0;
  const untilAudit =
    sess < auditMin
      ? auditMin - sess
      : auditEvery - (sess % auditEvery || auditEvery);
  const untilAnalyst =
    sess < ANALYST_APPLY_MIN_EVALS
      ? ANALYST_APPLY_MIN_EVALS - sess
      : ANALYST_APPLY_EVERY - (sess % ANALYST_APPLY_EVERY || ANALYST_APPLY_EVERY);

  return {
    primaryAgent: "live-learning",
    secondaryAgent: "log-auditor + analyst-skill-apply",
    sessionEvaluations: sess,
    sessionLogAudits: state.sessionLogAudits ?? 0,
    sessionSkillApplies: state.sessionSkillApplies ?? 0,
    totalLogAudits: state.logAudits ?? 0,
    lastLogAuditAt: state.lastLogAuditAt ?? 0,
    sessionUptimeSec: uptimeSec,
    auditEvery,
    analystApplyEvery: ANALYST_APPLY_EVERY,
    nextAuditInEvals: untilAudit,
    nextAnalystApplyInEvals: untilAnalyst,
    auditWarmedUp: sess >= auditMin && uptimeSec >= auditMinUptime,
    analystAutoApply: process.env.ZAMBAHOLA_ANALYST_AUTO_APPLY !== "0",
    directionalRolling: runtime?.directionalRolling,
    abstainRate: runtime?.abstainRate,
    statusAr:
      sess < auditMin
        ? `الوكيل الثاني ينتظر ${auditMin - sess} تقييم`
        : uptimeSec < auditMinUptime
          ? `الوكيل الثاني ينتظر ${auditMinUptime - uptimeSec}ث تشغيل`
          : `الوكيلان نشطان — مراجعات الجلسة: ${state.sessionLogAudits ?? 0}`,
  };
}

export interface LiveEvalContext {
  ensembleHit: boolean;
  direction?: "up" | "down" | "range";
  directionalHit?: boolean | null;
  regime?: string;
  strategyStats: StrategyHitStats[];
  engine: PredictionEngine;
}

/** Called after each evaluated prediction while agent is live */
export async function onLiveEvaluation(ctx: LiveEvalContext): Promise<LearningState> {
  let state = await getState();
  state.totalEvaluations += 1;
  state.sessionEvaluations = (state.sessionEvaluations ?? 0) + 1;

  const isDirectional = ctx.direction !== undefined && ctx.direction !== "range";
  const guard = recordHit(ctx.ensembleHit, {
    directional: isDirectional ? (ctx.directionalHit ?? ctx.ensembleHit) : null,
  });
  state.stabilizeMode = guard.stabilizeMode;
  state.peakHitRate = Math.max(state.peakHitRate ?? 0, guard.sessionPeak);
  state.peakDirectionalHitRate = Math.max(
    state.peakDirectionalHitRate ?? 0,
    guard.directionalPeak,
  );

  state = bumpUnderstanding(state, ctx.ensembleHit, ctx.engine.ml.getSampleCount(), {
    directionalHit: isDirectional ? (ctx.directionalHit ?? ctx.ensembleHit) : null,
  });
  updateRecoveryMetrics(state.directionalHitRateEma, guard.directionalRolling);
  updateHitRecoverRolling(guard.directionalRolling);

  state = await maybeSnapshotOrRestore(guard.rollingHitRate, state, (w) =>
    ctx.engine.setWeights(w),
  );
  state.mlpSamples = ctx.engine.mlp.getSampleCount();
  state.gbmSamples = ctx.engine.gbm.getSampleCount();

  let didUpdate = false;

  if (state.totalEvaluations % WEIGHT_EVERY === 0) {
    state.weightSaves += 1;
    didUpdate = true;
    await appendResearchLog({
      event: "live_weight_checkpoint",
      evaluations: state.totalEvaluations,
      hitRateEma: state.hitRateEma,
      understandingScore: state.understandingScore,
    });
  }

  const orchMin = orchestratorMinRolling();
  if (
    state.totalEvaluations % ORCH_EVERY === 0 &&
    ctx.strategyStats.length > 0 &&
    !shouldSkipOrchestratorBoost() &&
    (guard.directionalRolling >= orchMin || guard.rollingHitRate >= orchMin - 0.05)
  ) {
    const boosted = await boostTopStrategies(ctx.strategyStats, 10);
    ctx.engine.setWeights(boosted);
    state.orchestratorBoosts += 1;
    state.totalLearningUpdates += 1;
    didUpdate = true;
    await appendResearchLog({
      event: "live_orchestrator_boost",
      evaluations: state.totalEvaluations,
      top: ctx.strategyStats.slice(0, 5).map((s) => s.strategyId),
      understandingScore: state.understandingScore,
    });
  }

  if (isIntensiveLearn() && state.totalEvaluations % PATTERN_BOOST_EVERY === 0) {
    const regime = ctx.regime ?? "range";
    const base = await loadStrategyWeights(ALL_STRATEGIES.map((s) => s.id));
    const boosted = await boostFromPatternJournal(regime, base);
    ctx.engine.setWeights(boosted);
    state.totalLearningUpdates += 1;
    didUpdate = true;
    await appendResearchLog({
      event: "pattern_journal_weight_boost",
      regime,
      evaluations: state.totalEvaluations,
    });
  }

  if (state.totalEvaluations % EXPORT_EVERY === 0) {
    await ctx.engine.ml.save();
    await ctx.engine.mlp.save();
    await ctx.engine.gbm.save();
    await exportModelBundle("hybrid_v7_live");
    state.modelExports += 1;
    state.totalLearningUpdates += 1;
    didUpdate = true;
    await appendResearchLog({
      event: "live_model_export",
      evaluations: state.totalEvaluations,
      understandingScore: state.understandingScore,
    });
  }

  const sessionStartedAt = state.sessionStartedAt || state.startedAt;
  const auditEvery = Number(process.env.ZAMBAHOLA_LOG_AUDIT_EVERY ?? 50);
  const auditMin = Number(process.env.ZAMBAHOLA_LOG_AUDIT_MIN_EVALS ?? 40);
  const auditMinUptime = Number(process.env.ZAMBAHOLA_LOG_AUDIT_MIN_UPTIME_SEC ?? 180);
  const uptimeSec = sessionStartedAt
    ? Math.floor((Date.now() - sessionStartedAt) / 1000)
    : 0;
  const sess = state.sessionEvaluations;
  const auditMilestone =
    auditEvery > 0 &&
    sess >= auditMin &&
    sess % auditEvery === 0 &&
    uptimeSec >= auditMinUptime &&
    sess > (state.lastAuditSessionEval ?? 0);
  const analystMilestone =
    sess >= ANALYST_APPLY_MIN_EVALS &&
    sess > (state.lastAnalystSessionEval ?? 0) &&
    (auditMilestone ||
      (ANALYST_APPLY_EVERY > 0 && sess % ANALYST_APPLY_EVERY === 0));

  if ((auditMilestone || analystMilestone) && !enqueuedDualAt.has(sess)) {
    enqueuedDualAt.add(sess);
    enqueueDualAgent({
      engine: ctx.engine,
      sessionEvaluations: state.sessionEvaluations,
      sessionStartedAt,
      directionalRolling: guard.directionalRolling,
      regime: ctx.regime,
      scheduleAudit: auditMilestone,
      scheduleAnalyst: analystMilestone,
    });
  }

  if (didUpdate) state.totalLearningUpdates += 1;

  await saveLearningState(state);
  statePromise = Promise.resolve(state);
  return state;
}

export async function getLiveLearningState(): Promise<LearningState> {
  return getState();
}
