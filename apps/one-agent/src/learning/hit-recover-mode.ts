/** Climb directional hit — strict filter + no lean when rolling is weak */

let directionalRolling = 0;

export function updateHitRecoverRolling(roll: number): void {
  directionalRolling = roll;
}

export function isHitRecoverMode(): boolean {
  if (process.env.ZAMBAHOLA_HIT_RECOVER === "0") return false;
  if (process.env.ZAMBAHOLA_HIT_RECOVER === "1") return true;
  const th = Number(process.env.ZAMBAHOLA_HIT_RECOVER_ROLLING ?? 0.4);
  return directionalRolling > 0 && directionalRolling < th;
}

export function hitRecoverStatusAr(): string {
  return isHitRecoverMode()
    ? "استعادة دقة — فلتر صارم (هدف 50%+)"
    : "عادي";
}
