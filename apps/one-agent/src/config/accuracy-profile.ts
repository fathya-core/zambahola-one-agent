/** Accuracy tuning — `ZAMBAHOLA_ACCURACY_MODE=max` for highest hit-rate focus */

export type AccuracyMode = "normal" | "max";

export function getAccuracyMode(): AccuracyMode {
  return process.env.ZAMBAHOLA_ACCURACY_MODE === "max" ? "max" : "normal";
}

export function isMaxAccuracy(): boolean {
  return getAccuracyMode() === "max";
}

/** Strict abstain filter — live agent only by default (off during train/backtest) */
export function isAccuracyFilterActive(): boolean {
  if (!isMaxAccuracy()) return false;
  if (process.env.ZAMBAHOLA_ACCURACY_FILTER === "off") return false;
  if (process.env.ZAMBAHOLA_ACCURACY_FILTER === "all") return true;
  return process.env.ZAMBAHOLA_LIVE_FILTER === "1";
}

export interface AccuracyTuning {
  ensembleNorm: number;
  blendCombined: number;
  minAgreement: number;
  minModelVoters: number;
  rangeAgreementBlock: number;
  counterTrendAgreement: number;
  horizonSec: number;
  orchestratorTopN: number;
}

const NORMAL: AccuracyTuning = {
  ensembleNorm: 0.12,
  blendCombined: 0.09,
  minAgreement: 0,
  minModelVoters: 2,
  rangeAgreementBlock: 0.55,
  counterTrendAgreement: 0.6,
  horizonSec: 30,
  orchestratorTopN: 6,
};

const MAX: AccuracyTuning = {
  ensembleNorm: 0.16,
  blendCombined: 0.12,
  minAgreement: 0.58,
  minModelVoters: 3,
  rangeAgreementBlock: 0.62,
  counterTrendAgreement: 0.68,
  horizonSec: 45,
  orchestratorTopN: 10,
};

export function getAccuracyTuning(): AccuracyTuning {
  const base = isMaxAccuracy() ? MAX : NORMAL;
  const horizon = Number(process.env.ZAMBAHOLA_HORIZON_SEC ?? base.horizonSec);
  const minAgreement = Number(
    process.env.ZAMBAHOLA_MIN_AGREEMENT ?? base.minAgreement,
  );
  const minModelVoters = Number(
    process.env.ZAMBAHOLA_MIN_MODEL_VOTERS ?? base.minModelVoters,
  );
  return {
    ...base,
    horizonSec: horizon,
    minAgreement,
    minModelVoters,
  };
}

/** Recommended env for home PC / full Binance access */
export const LOCAL_MAX_ENV: Record<string, string> = {
  ZAMBAHOLA_ACCURACY_MODE: "max",
  ZAMBAHOLA_FEED: "universal",
  ZAMBAHOLA_FAST: "1",
  ZAMBAHOLA_TICK_MS: "350",
  ZAMBAHOLA_AUTO_BYBIT: "1",
  ZAMBAHOLA_HORIZON_SEC: "45",
  ZAMBAHOLA_LEARN_CYCLES: "30",
  ZAMBAHOLA_DEEP_CYCLES: "25",
  ZAMBAHOLA_ULTRA_CYCLES: "25",
  ZAMBAHOLA_ULTRA_KLINES: "10000",
  ZAMBAHOLA_KLINES: "5000",
  ZAMBAHOLA_LOB_DEPTH: "128",
};
