import { guardRelaxed, isIntensiveLearn } from "./intensive-learn.js";

let directionalHitRateEma = 0;
let directionalRolling = 0;

export function updateRecoveryMetrics(
  dirEma: number,
  dirRolling?: number,
): void {
  directionalHitRateEma = dirEma;
  if (dirRolling != null) directionalRolling = dirRolling;
}

/** When hit rate is already low — learn aggressively, do not stabilize */
export function isRecoveryMode(): boolean {
  if (guardRelaxed() || isIntensiveLearn()) return true;

  const emaTh = Number(process.env.ZAMBAHOLA_RECOVERY_DIR_EMA ?? 0.45);
  const rollTh = Number(process.env.ZAMBAHOLA_RECOVERY_ROLLING ?? 0.42);

  if (directionalHitRateEma > 0 && directionalHitRateEma < emaTh) return true;
  if (directionalRolling > 0 && directionalRolling < rollTh) return true;
  return false;
}

export function recoveryStatusAr(): string {
  return isRecoveryMode()
    ? "استرداد — تعلّم سريع (بدون تجميد)"
    : "عادي";
}
