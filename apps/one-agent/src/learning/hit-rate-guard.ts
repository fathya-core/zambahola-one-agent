import { saveBestWeights, loadBestWeights, restoreBestWeightsToFile } from "./weight-snapshot.js";
import { appendResearchLog } from "./adaptive-weights.js";
import type { LearningState } from "./learning-state.js";

const WINDOW = Number(process.env.ZAMBAHOLA_HIT_WINDOW ?? 60);
const DROP_TRIGGER = Number(process.env.ZAMBAHOLA_HIT_DROP ?? 0.12);
const FLOOR = Number(process.env.ZAMBAHOLA_HIT_FLOOR ?? 0.55);
const DIR_FLOOR = Number(process.env.ZAMBAHOLA_DIR_HIT_FLOOR ?? 0.58);

const recentOverall: boolean[] = [];
const recentDirectional: boolean[] = [];
let sessionPeak = 0;
let sessionPeakDirectional = 0;
let stabilizeMode = false;
let lastRestoreAt = 0;

function useDirectionalGuard(): boolean {
  return process.env.ZAMBAHOLA_GUARD_METRIC !== "overall";
}

function rollingOf(buf: boolean[]): number {
  return buf.length > 0 ? buf.filter(Boolean).length / buf.length : 0;
}

export function recordHit(
  hit: boolean,
  opts?: { directional?: boolean | null },
): {
  rollingHitRate: number;
  sessionPeak: number;
  stabilizeMode: boolean;
  directionalRolling: number;
  directionalPeak: number;
  guardMetric: "directional" | "overall";
} {
  recentOverall.push(hit);
  if (recentOverall.length > WINDOW) recentOverall.shift();

  if (opts?.directional !== undefined && opts.directional !== null) {
    recentDirectional.push(opts.directional);
    if (recentDirectional.length > WINDOW) recentDirectional.shift();
  }

  const overallRolling = rollingOf(recentOverall);
  const dirRolling = rollingOf(recentDirectional);
  const guardMetric = useDirectionalGuard() ? "directional" : "overall";
  const rolling =
    guardMetric === "directional" && recentDirectional.length >= 8
      ? dirRolling
      : overallRolling;

  sessionPeak = Math.max(sessionPeak, overallRolling);
  sessionPeakDirectional = Math.max(sessionPeakDirectional, dirRolling);

  const peakForGuard =
    guardMetric === "directional" ? sessionPeakDirectional : sessionPeak;
  const droppedFromPeak = peakForGuard - rolling >= DROP_TRIGGER;
  const floor =
    guardMetric === "directional" ? DIR_FLOOR : FLOOR;
  const minSamples = guardMetric === "directional" ? 15 : 20;
  const belowFloor = recentDirectional.length >= minSamples && rolling < floor;

  if ((droppedFromPeak || belowFloor) && !stabilizeMode) {
    stabilizeMode = true;
    void appendResearchLog({
      event: "hit_rate_guard_on",
      rolling,
      sessionPeak: peakForGuard,
      guardMetric,
      reason: droppedFromPeak ? "drop_from_peak" : "below_floor",
    });
  }

  if (stabilizeMode && rolling >= peakForGuard - 0.05 && rolling >= floor + 0.04) {
    stabilizeMode = false;
    void appendResearchLog({
      event: "hit_rate_guard_off",
      rolling,
      sessionPeak: peakForGuard,
      guardMetric,
    });
  }

  return {
    rollingHitRate: Number(rolling.toFixed(4)),
    sessionPeak: Number(peakForGuard.toFixed(4)),
    stabilizeMode,
    directionalRolling: Number(dirRolling.toFixed(4)),
    directionalPeak: Number(sessionPeakDirectional.toFixed(4)),
    guardMetric,
  };
}

export function isStabilizeMode(): boolean {
  return stabilizeMode || process.env.ZAMBAHOLA_STABILIZE === "1";
}

export function shouldPauseMlTrain(): boolean {
  return isStabilizeMode();
}

export function shouldSkipOrchestratorBoost(): boolean {
  return isStabilizeMode();
}

export function gentleWeightMultipliers(): { hit: number; miss: number } {
  if (isStabilizeMode()) return { hit: 1.008, miss: 0.992 };
  return { hit: 1.025, miss: 0.975 };
}

/** Save snapshot when rolling high; restore if guard triggered hard */
export async function maybeSnapshotOrRestore(
  rollingHitRate: number,
  state: LearningState,
  applyWeights: (w: Record<string, number>) => void,
): Promise<LearningState> {
  const metric =
    useDirectionalGuard() && state.directionalHitRateEma
      ? state.directionalHitRateEma
      : rollingHitRate;

  if (
    metric >= 0.72 &&
    state.totalEvaluations >= 40 &&
    metric >= (state.peakDirectionalHitRate ?? state.peakHitRate ?? 0) - 0.02
  ) {
    const { loadStrategyWeights } = await import("./adaptive-weights.js");
    const { ALL_STRATEGIES } = await import("../prediction-engine/strategies/index.js");
    const w = await loadStrategyWeights(ALL_STRATEGIES.map((s) => s.id));
    await saveBestWeights(w, metric, state.totalEvaluations);
    state.peakHitRate = Math.max(state.peakHitRate ?? 0, rollingHitRate);
    state.peakDirectionalHitRate = Math.max(
      state.peakDirectionalHitRate ?? 0,
      state.directionalHitRateEma ?? 0,
    );
  }

  if (
    isStabilizeMode() &&
    Date.now() - lastRestoreAt > 120_000 &&
    metric < (state.peakDirectionalHitRate ?? state.peakHitRate ?? 0.7) - DROP_TRIGGER
  ) {
    const best = await loadBestWeights();
    if (best && best.meta.hitRate >= metric + 0.08) {
      const meta = await restoreBestWeightsToFile();
      if (meta) {
        applyWeights(best.weights);
        lastRestoreAt = Date.now();
        state.weightRestores = (state.weightRestores ?? 0) + 1;
        await appendResearchLog({
          event: "weights_restored",
          restoredFromHitRate: meta.hitRate,
          currentRolling: metric,
        });
      }
    }
  }

  return state;
}

export function getGuardStatus() {
  const overall = rollingOf(recentOverall);
  const dir = rollingOf(recentDirectional);
  const guardMetric = useDirectionalGuard() ? "directional" : "overall";
  const rolling =
    guardMetric === "directional" && recentDirectional.length >= 8 ? dir : overall;

  return {
    rollingHitRate: Number(rolling.toFixed(4)),
    overallRollingHitRate: Number(overall.toFixed(4)),
    directionalRollingHitRate: Number(dir.toFixed(4)),
    sessionPeak: Number(sessionPeak.toFixed(4)),
    directionalPeak: Number(sessionPeakDirectional.toFixed(4)),
    stabilizeMode: isStabilizeMode(),
    guardMetric,
    windowSize: recentOverall.length,
    directionalWindowSize: recentDirectional.length,
    windowMax: WINDOW,
  };
}
