#!/usr/bin/env node
/** Night train — continuous omni cycles until ~30m before day (phase5 scheduler) */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./lib/run-npm.mjs";
import { forceStopAgent } from "./phase5-agent-stop.mjs";
import { startAgentDetached } from "./phase5-agent-start.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
  }
}

loadEnvFile(join(root, "config", "phase5-ready.env"));
loadEnvFile(join(root, "config", "phase5-night-train.env"));

const fullTrainDow = Number(process.env.ZAMBAHOLA_PHASE5_FULL_TRAIN_DOW ?? 5);
const tz = process.env.ZAMBAHOLA_PHASE5_TZ ?? "Asia/Riyadh";
const dayStart = Number(process.env.ZAMBAHOLA_PHASE5_DAY_START ?? 6);
const continuous = process.env.ZAMBAHOLA_PHASE5_NIGHT_CONTINUOUS !== "0";
const stopBeforeDayMin = Number(process.env.ZAMBAHOLA_PHASE5_NIGHT_STOP_BEFORE_DAY_MIN ?? 30);
const cycleGapMin = Number(process.env.ZAMBAHOLA_PHASE5_NIGHT_CYCLE_GAP_MIN ?? 3);

function localParts() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour ?? 0);
  const minute = Number(parts.minute ?? 0);
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[parts.weekday] ?? 0;
  const isNight = hour >= Number(process.env.ZAMBAHOLA_PHASE5_NIGHT_START ?? 20) || hour < dayStart;
  let minutesUntilDay;
  if (hour >= dayStart) {
    minutesUntilDay = (24 - hour + dayStart) * 60 - minute;
  } else {
    minutesUntilDay = (dayStart - hour) * 60 - minute;
  }
  return { hour, minute, dow, isNight, minutesUntilDay };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTrainProfile(trainArgs, label) {
  console.log(`[phase5-night] trying ${label}...`);
  return runNpm(trainArgs, { cwd: root, env: process.env });
}

console.log("[phase5-night] stopping agent...");
const stopped = await forceStopAgent();
if (!stopped) {
  console.error("[phase5-night] WARN: agent still responding on :8787");
}

spawnSync("git", ["pull", "origin", "main"], { cwd: root, stdio: "inherit" });

const parts0 = localParts();
console.log(
  `[phase5-night] plan: continuous=${continuous} stopBeforeDay=${stopBeforeDayMin}m ` +
    `minsUntilDay=${parts0.minutesUntilDay}`,
);

let cycle = 0;
let anyTrainOk = false;

while (true) {
  const parts = localParts();
  if (!parts.isNight || parts.minutesUntilDay <= stopBeforeDayMin) {
    console.log(
      `[phase5-night] train window ended (${parts.minutesUntilDay}m until day ${dayStart}:00)`,
    );
    break;
  }

  cycle += 1;
  const useFull = parts.dow === fullTrainDow && cycle === 1;
  const primaryArgs = useFull
    ? ["run", "agent:omni-train"]
    : ["run", "agent:omni-train:night"];

  console.log(
    `[phase5-night] cycle ${cycle}/${continuous ? "∞" : "1"} ` +
      `(full=${useFull}, ${parts.minutesUntilDay}m until day)...`,
  );

  let train = await runTrainProfile(primaryArgs, useFull ? "omni-train full" : "omni-train:night");
  if (!train.ok) {
    console.error("[phase5-night] primary train failed — fallback quick");
    train = await runTrainProfile(["run", "agent:omni-train:quick"], "omni-train:quick");
  }

  if (train.ok) {
    anyTrainOk = true;
  } else {
    console.error("[phase5-night] cycle failed (primary + quick) — stopping train loop");
    break;
  }

  if (!continuous) break;

  const after = localParts();
  if (!after.isNight || after.minutesUntilDay <= stopBeforeDayMin) break;

  console.log(`[phase5-night] cycle ${cycle} done — pause ${cycleGapMin}m then next...`);
  await sleep(cycleGapMin * 60_000);
}

if (!anyTrainOk) {
  console.error("[phase5-night] WARN: no train cycle succeeded — starting agent anyway");
}

console.log("[phase5-night] training complete — starting agent...");

const agentCmd = process.env.ZAMBAHOLA_PHASE5_AGENT_CMD ?? "agent:phase5-ready";
const started = await startAgentDetached(agentCmd);
if (!started.ok) {
  console.error(`[phase5-night] agent failed to start — run manually: npm run ${agentCmd}`);
  process.exit(1);
}
console.log("[phase5-night] done");
