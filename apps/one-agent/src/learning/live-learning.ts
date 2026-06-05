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

const WEIGHT_EVERY = Number(process.env.ZAMBAHOLA_LIVE_WEIGHT_EVERY ?? 5);
const ORCH_EVERY = Number(process.env.ZAMBAHOLA_LIVE_ORCH_EVERY ?? 12);
const EXPORT_EVERY = Number(process.env.ZAMBAHOLA_LIVE_EXPORT_EVERY ?? 40);

let statePromise: Promise<LearningState> | null = null;

async function getState(): Promise<LearningState> {
  if (!statePromise) statePromise = loadLearningState();
  return statePromise;
}

export interface LiveEvalContext {
  ensembleHit: boolean;
  direction?: "up" | "down" | "range";
  directionalHit?: boolean | null;
  strategyStats: StrategyHitStats[];
  engine: PredictionEngine;
}

/** Called after each evaluated prediction while agent is live */
export async function onLiveEvaluation(ctx: LiveEvalContext): Promise<LearningState> {
  let state = await getState();
  state.totalEvaluations += 1;

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

  if (
    state.totalEvaluations % ORCH_EVERY === 0 &&
    ctx.strategyStats.length > 0 &&
    !shouldSkipOrchestratorBoost() &&
    (guard.directionalRolling >= 0.55 || guard.rollingHitRate >= 0.52)
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

  if (didUpdate) state.totalLearningUpdates += 1;

  await saveLearningState(state);
  statePromise = Promise.resolve(state);
  return state;
}

export async function getLiveLearningState(): Promise<LearningState> {
  return getState();
}
