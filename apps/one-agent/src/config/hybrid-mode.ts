/** Auto-switch learn-trade (range) vs signals (trend) — ZAMBAHOLA_HYBRID_AUTO=1 */

export type HybridProfile = "learn" | "signals";

let currentProfile: HybridProfile = "learn";
let pendingRegime: string | null = null;
let pendingTicks = 0;
let lastSwitchAt = 0;
let switchCount = 0;

export function isHybridAuto(): boolean {
  return process.env.ZAMBAHOLA_HYBRID_AUTO === "1";
}

function regimeToProfile(regime: string): HybridProfile {
  return regime === "range" ? "learn" : "signals";
}

export function getHybridProfile(): HybridProfile | null {
  if (!isHybridAuto()) return null;
  return currentProfile;
}

export function isLearnTradeActive(): boolean {
  if (isHybridAuto()) return currentProfile === "learn";
  return process.env.ZAMBAHOLA_LEARN_TRADE === "1";
}

export function isSignalsStrictActive(): boolean {
  if (isHybridAuto()) return currentProfile === "signals";
  return process.env.ZAMBAHOLA_LEARN_TRADE !== "1";
}

export function resolveHorizonSec(): number {
  if (isHybridAuto()) {
    if (currentProfile === "learn") {
      return Number(process.env.ZAMBAHOLA_HORIZON_LEARN ?? 25);
    }
    return Number(process.env.ZAMBAHOLA_HORIZON_SIGNALS ?? 45);
  }
  return Number(
    process.env.ZAMBAHOLA_HORIZON_SEC ??
      (process.env.ZAMBAHOLA_LEARN_TRADE === "1" ? 25 : 45),
  );
}

export function resolveTradeMaxHoldSec(horizonSec: number): number {
  if (!isLearnTradeActive()) return 0;
  return Number(
    process.env.ZAMBAHOLA_TRADE_MAX_HOLD_SEC ?? Math.round(horizonSec * 1.2),
  );
}

export interface HybridUpdate {
  profile: HybridProfile;
  switched: boolean;
  pendingRegime: string | null;
  switchCount: number;
}

/** Hysteresis — avoid flip-flop every tick */
export function updateHybridRegime(regime: string): HybridUpdate {
  if (!isHybridAuto()) {
    const p: HybridProfile =
      process.env.ZAMBAHOLA_LEARN_TRADE === "1" ? "learn" : "signals";
    return {
      profile: p,
      switched: false,
      pendingRegime: null,
      switchCount: 0,
    };
  }

  const target = regimeToProfile(regime);
  if (target === currentProfile) {
    pendingRegime = null;
    pendingTicks = 0;
    return {
      profile: currentProfile,
      switched: false,
      pendingRegime: null,
      switchCount,
    };
  }

  if (pendingRegime !== regime) {
    pendingRegime = regime;
    pendingTicks = 1;
  } else {
    pendingTicks += 1;
  }

  const need = Number(process.env.ZAMBAHOLA_HYBRID_SWITCH_TICKS ?? 12);
  if (pendingTicks < need) {
    return {
      profile: currentProfile,
      switched: false,
      pendingRegime,
      switchCount,
    };
  }

  currentProfile = target;
  pendingRegime = null;
  pendingTicks = 0;
  lastSwitchAt = Date.now();
  switchCount += 1;

  return {
    profile: currentProfile,
    switched: true,
    pendingRegime: null,
    switchCount,
  };
}

export function hybridStatusAr(profile: HybridProfile | null): string {
  if (!profile) return "—";
  return profile === "learn"
    ? "تعلّم + تداول ورقي (نطاق range)"
    : "إشارات دقيقة (ترند / تذبذب عالي)";
}
