#!/usr/bin/env node
/** Clear tonight's phase5 night state so scheduler runs train immediately */
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stateFile = join(root, "apps/one-agent/data/bridge/PHASE5-STATE.json");
const tz = process.env.ZAMBAHOLA_PHASE5_TZ ?? "Asia/Riyadh";

function todayKey() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const dateKey = todayKey();
let prev = null;
if (existsSync(stateFile)) {
  try {
    prev = JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    /* */
  }
}

const state = {
  lastNightTrainKey: null,
  nightTrainInProgress: false,
  lastMode: null,
  resetAt: new Date().toISOString(),
  resetForDateKey: dateKey,
  previousLastNightTrainKey: prev?.lastNightTrainKey ?? null,
  updatedAt: Date.now(),
};

await mkdir(dirname(stateFile), { recursive: true });
await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");

const verifyPath = join(root, "apps/one-agent/data/bridge/PHASE5-NIGHT-VERIFY.json");
if (existsSync(verifyPath)) {
  try {
    await unlink(verifyPath);
  } catch {
    /* */
  }
}

console.log(`[phase5-reset] cleared night state for ${dateKey}`);
if (prev?.lastNightTrainKey) {
  console.log(`[phase5-reset] was: lastNightTrainKey=${prev.lastNightTrainKey}`);
}
console.log("[phase5-reset] next: npm run agent:phase5-auto  (enters night train on first tick)");
