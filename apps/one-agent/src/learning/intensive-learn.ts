import { isHybridAuto, isLearnTradeActive } from "../config/hybrid-mode.js";

/** Aggressive live learning — relax guard, boost weights faster */
export function isIntensiveLearn(): boolean {
  if (process.env.ZAMBAHOLA_INTENSIVE_LEARN === "1") return true;
  if (process.env.ZAMBAHOLA_INTENSIVE_LEARN === "0") return false;
  return isHybridAuto() && isLearnTradeActive();
}

export function orchestratorMinRolling(): number {
  if (isIntensiveLearn()) {
    return Number(process.env.ZAMBAHOLA_ORCH_MIN_ROLLING ?? 0.28);
  }
  return Number(process.env.ZAMBAHOLA_ORCH_MIN_ROLLING ?? 0.55);
}

export function guardRelaxed(): boolean {
  return (
    isIntensiveLearn() || process.env.ZAMBAHOLA_GUARD_RELAX === "1"
  );
}
