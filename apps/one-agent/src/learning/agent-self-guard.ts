import type { PredictionEngine } from "../prediction-engine/index.js";
import type { AgentMetrics } from "../types.js";
import { getLiveLearningState } from "./live-learning.js";
import { maybeRunLiveLogAudit } from "./log-audit-hook.js";
import { applyAnalystSkillActions } from "./analyst-skill-apply.js";
import { getGuardStatus } from "./hit-rate-guard.js";

const EVERY_TICKS = Number(process.env.ZAMBAHOLA_SELF_GUARD_EVERY ?? 120);
let lastSelfHealAt = 0;
const COOLDOWN_MS = Number(process.env.ZAMBAHOLA_SELF_GUARD_COOLDOWN_MS ?? 240_000);

export interface SelfGuardContext {
  tickCount: number;
  startedAt: number | null;
  metrics: AgentMetrics;
  engine: PredictionEngine;
}

/** In-process watchdog — fixes without waiting for cloud or external guard */
export function maybeSelfHeal(ctx: SelfGuardContext): void {
  if (process.env.ZAMBAHOLA_SELF_GUARD === "0") return;
  if (ctx.tickCount % EVERY_TICKS !== 0) return;
  if (Date.now() - lastSelfHealAt < COOLDOWN_MS) return;

  void runSelfHeal(ctx).catch((err) => {
    console.warn("[zambahola] self-guard:", err);
  });
}

async function runSelfHeal(ctx: SelfGuardContext): Promise<void> {
  const uptimeSec = ctx.startedAt
    ? Math.floor((Date.now() - ctx.startedAt) / 1000)
    : 0;
  if (uptimeSec < 180) return;

  const abstain = ctx.metrics.abstainRate ?? 0;
  const dirCount = ctx.metrics.directionalCount ?? 0;
  const state = await getLiveLearningState();
  const guard = getGuardStatus();
  const sess = state.sessionEvaluations ?? 0;
  const audits = state.sessionLogAudits ?? 0;

  let healed = false;

  if (sess >= 50 && audits === 0 && uptimeSec >= 300) {
    const report = await maybeRunLiveLogAudit({
      engine: ctx.engine,
      sessionEvaluations: sess,
      directionalRolling: guard.directionalRollingHitRate,
      sessionStartedAt: state.sessionStartedAt || ctx.startedAt || Date.now(),
    });
    if (report) healed = true;
  }

  if (abstain >= 0.9 && dirCount < 3 && sess >= 40) {
    await applyAnalystSkillActions({
      engine: ctx.engine,
      regime: ctx.metrics.regime,
      directionalRolling: guard.directionalRollingHitRate,
      abstainRate: abstain,
      totalEvaluations: sess,
      startedAt: state.sessionStartedAt || ctx.startedAt || undefined,
      skipLogReviewApply: healed,
    });
    healed = true;
  }

  if (healed) {
    lastSelfHealAt = Date.now();
    console.log("[zambahola] self-guard applied in-process heal");
  }
}
