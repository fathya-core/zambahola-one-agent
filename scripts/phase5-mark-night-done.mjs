#!/usr/bin/env node
/** Mark tonight's omni-train as done (after manual night-now or interrupted run) */
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

let state = { lastNightTrainKey: null, nightTrainInProgress: false };
if (existsSync(stateFile)) {
  try {
    state = { ...state, ...JSON.parse(await readFile(stateFile, "utf8")) };
  } catch {
    /* fresh */
  }
}

const dateKey = todayKey();
state.lastNightTrainKey = dateKey;
state.nightTrainInProgress = false;
state.updatedAt = Date.now();

await mkdir(dirname(stateFile), { recursive: true });
await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
console.log(`[phase5] night train marked done for ${dateKey} — restart agent:phase5-auto if scheduler is open`);
