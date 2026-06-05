import { saveBestWeights, loadBestWeights, restoreBestWeightsToFile } from "./weight-snapshot.js";
import { appendResearchLog } from "./adaptive-weights.js";
import type { LearningState } from "./learning-state.js";

const WINDOW = Number(process.env.ZAMBAHOLA_HIT_WINDOW ?? 60);
const DROP_TRIGGER = Number(process.env.ZAMBAHOLA_HIT_DROP ?? 0.12);
const FLOOR = Number(process.env.ZAMBAHOLA_HIT_FLOOR ?? 0.55);

const recent: boolean[] = [];
let sessionPeak = 0;
let stabilizeMode = false;
let lastRestoreAt = 0;

export function recordHit(hit: boolean): {
  rollingHitRate: number;
  sessionPeak: number;
  stabilizeMode: boolean;
  directionalRolling?: number;
} {
  recent.push(hit);
  if (recent.length > WINDOW) recent.shift();

  const rolling =
    recent.length > 0 ? recent.filter(Boolean).length / recent.length : 0;
  sessionPeak = Math.max(sessionPeak, rolling);

  const droppedFromPeak = sessionPeak - rolling >= DROP_TRIGGER;
  const belowFloor = recent.length >= 20 && rolling < FLOOR;

  if ((droppedFromPeak || belowFloor) && !stabilizeMode) {
    stabilizeMode = true;
    void appendResearchLog({
      event: "hit_rate_guard_on",
      rolling,
      sessionPeak,
      reason: droppedFromPeak ? "drop_from_peak" : "below_floor",
    });
  }

  if (stabilizeMode && rolling >= sessionPeak - 0.05 && rolling >= 0.62) {
    stabilizeMode = false;
    void appendResearchLog({
      event: "hit_rate_guard_off",
      rolling,
      sessionPeak,
    });
  }

  return {
    rollingHitRate: Number(rolling.toFixed(4)),
    sessionPeak: Number(sessionPeak.toFixed(4)),
    stabilizeMode,
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
  if (
    rollingHitRate >= 0.72 &&
    state.totalEvaluations >= 40 &&
    rollingHitRate >= sessionPeak - 0.02
  ) {
    const { loadStrategyWeights } = await import("./adaptive-weights.js");
    const { ALL_STRATEGIES } = await import("../prediction-engine/strategies/index.js");
    const w = await loadStrategyWeights(ALL_STRATEGIES.map((s) => s.id));
    await saveBestWeights(w, rollingHitRate, state.totalEvaluations);
    state.peakHitRate = rollingHitRate;
  }

  if (
    isStabilizeMode() &&
    Date.now() - lastRestoreAt > 120_000 &&
    rollingHitRate < sessionPeak - DROP_TRIGGER
  ) {
    const best = await loadBestWeights();
    if (best && best.meta.hitRate >= rollingHitRate + 0.08) {
      const meta = await restoreBestWeightsToFile();
      if (meta) {
        applyWeights(best.weights);
        lastRestoreAt = Date.now();
        state.weightRestores = (state.weightRestores ?? 0) + 1;
        await appendResearchLog({
          event: "weights_restored",
          restoredFromHitRate: meta.hitRate,
          currentRolling: rollingHitRate,
        });
      }
    }
  }

  return state;
}

export function getGuardStatus() {
  const rolling =
    recent.length > 0 ? recent.filter(Boolean).length / recent.length : 0;
  return {
    rollingHitRate: Number(rolling.toFixed(4)),
    sessionPeak: Number(sessionPeak.toFixed(4)),
    stabilizeMode: isStabilizeMode(),
    windowSize: recent.length,
    windowMax: WINDOW,
  };
}
