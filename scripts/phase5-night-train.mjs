#!/usr/bin/env node
/** Run night omni-train now (manual or scheduler) */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./lib/run-npm.mjs";
import { forceStopAgent } from "./phase5-agent-stop.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadPhase5EnvFile() {
  const path = join(root, "config", "phase5-ready.env");
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
loadPhase5EnvFile();

const fullTrainDow = Number(process.env.ZAMBAHOLA_PHASE5_FULL_TRAIN_DOW ?? 5);
const tz = process.env.ZAMBAHOLA_PHASE5_TZ ?? "Asia/Riyadh";

function localDow() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return dowMap[parts.weekday] ?? 0;
}

console.log("[phase5-night] stopping agent...");
const stopped = await forceStopAgent();
if (!stopped) {
  console.error("[phase5-night] WARN: agent still responding on :8787");
}

spawnSync("git", ["pull", "origin", "main"], { cwd: root, stdio: "inherit" });

const useFull = localDow() === fullTrainDow;
const trainArgs = useFull ? ["run", "agent:omni-train"] : ["run", "agent:omni-train:quick"];
console.log(`[phase5-night] omni-train (full=${useFull})...`);
const train = runNpm(trainArgs, { cwd: root });
if (!train.ok) {
  console.error("[phase5-night] omni-train failed");
  process.exit(train.status ?? 1);
}

runNpm(["run", "agent:export-models"], { cwd: root });

console.log("[phase5-night] starting phase5-ready (background)...");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const { spawn } = await import("node:child_process");
const child = spawn(npm, ["run", "agent:phase5-ready"], {
  cwd: root,
  detached: true,
  stdio: "ignore",
  shell: isWin,
});
child.unref();
console.log("[phase5-night] done");
