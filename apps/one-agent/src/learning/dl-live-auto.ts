import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendResearchLog } from "./adaptive-weights.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STATE_FILE = join(pkgRoot, "data", "learning", "dl-live-auto.json");

export interface DlLiveAutoState {
  enabled: boolean;
  stableSince: number | null;
  lastToggleAt: number;
  lastDirectionalRolling: number;
  lastDirectionalCount: number;
  reason: string;
}

let cache: DlLiveAutoState | null = null;
let stableSince: number | null = null;

function isAutoEnabled(): boolean {
  return process.env.ZAMBAHOLA_DL_LIVE_AUTO === "1";
}

async function persist(state: DlLiveAutoState): Promise<void> {
  cache = state;
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export async function loadDlLiveAutoState(): Promise<DlLiveAutoState | null> {
  if (cache) return cache;
  if (!existsSync(STATE_FILE)) return null;
  try {
    cache = JSON.parse(await readFile(STATE_FILE, "utf8")) as DlLiveAutoState;
    stableSince = cache.stableSince;
    return cache;
  } catch {
    return null;
  }
}

/** Toggle ZAMBAHOLA_DL_LIVE_TRAIN when directional rolling is strong enough (phase5). */
export async function syncDlLiveTrain(opts: {
  directionalRolling: number;
  directionalCount: number;
}): Promise<DlLiveAutoState | null> {
  if (!isAutoEnabled()) return null;

  const minRoll = Number(process.env.ZAMBAHOLA_DL_LIVE_MIN_DIR_ROLLING ?? 0.4);
  const minCount = Number(process.env.ZAMBAHOLA_DL_LIVE_MIN_DIR_COUNT ?? 15);
  const stableSec = Number(process.env.ZAMBAHOLA_DL_LIVE_STABLE_SEC ?? 7200);
  const offRoll = Number(process.env.ZAMBAHOLA_DL_LIVE_OFF_DIR_ROLLING ?? 0.35);

  const roll = opts.directionalRolling;
  const count = opts.directionalCount;
  const now = Date.now();
  const wasOn = process.env.ZAMBAHOLA_DL_LIVE_TRAIN === "1";

  let reason = wasOn ? "dl_live_on" : "dl_live_off_guarded";
  let wantOn = wasOn;

  if (roll >= minRoll && count >= minCount) {
    if (!stableSince) stableSince = now;
    if (now - stableSince >= stableSec) {
      wantOn = true;
      reason = `unlock_dir_${roll.toFixed(2)}_n${count}_stable_${Math.floor((now - stableSince) / 1000)}s`;
    } else {
      reason = `warming_${Math.floor((now - stableSince) / 1000)}s_of_${stableSec}s`;
    }
  } else {
    stableSince = null;
    if (roll < offRoll || count < minCount) {
      wantOn = false;
      reason =
        count < minCount
          ? `blocked_dir_count_${count}_need_${minCount}`
          : `blocked_dir_roll_${roll.toFixed(2)}_need_${minRoll}`;
    }
  }

  if (wantOn !== wasOn) {
    process.env.ZAMBAHOLA_DL_LIVE_TRAIN = wantOn ? "1" : "0";
    await appendResearchLog({
      event: wantOn ? "dl_live_auto_on" : "dl_live_auto_off",
      directionalRolling: roll,
      directionalCount: count,
      reason,
    });
  }

  const state: DlLiveAutoState = {
    enabled: process.env.ZAMBAHOLA_DL_LIVE_TRAIN === "1",
    stableSince,
    lastToggleAt: wantOn !== wasOn ? now : (cache?.lastToggleAt ?? now),
    lastDirectionalRolling: roll,
    lastDirectionalCount: count,
    reason,
  };
  await persist(state);
  return state;
}

export function isDlLiveTrainEnabled(): boolean {
  return process.env.ZAMBAHOLA_DL_LIVE_TRAIN === "1";
}
