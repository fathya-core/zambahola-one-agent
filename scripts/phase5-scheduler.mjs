#!/usr/bin/env node
/**
 * Phase 5 — أتمتة نهار/ليل بدون أوامر يدوية.
 *
 * نهاراً: وكيل phase5-ready + bridge + watcher + guard + telemetry
 * ليلاً: إيقاف الوكيل → omni-train → export → إعادة phase5
 *
 * شغّل مرة واحدة واترك النافذة مفتوحة:
 *   npm run agent:phase5-auto
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./lib/run-npm.mjs";

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
    if (process.env[key] === undefined) {
      process.env[key] = t.slice(eq + 1).trim();
    }
  }
}
loadPhase5EnvFile();

const logFile = join(root, "apps/one-agent/data/bridge/PHASE5-SCHEDULER.jsonl");
const stateFile = join(root, "apps/one-agent/data/bridge/PHASE5-STATE.json");
const agentUrl = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

const tz = process.env.ZAMBAHOLA_PHASE5_TZ ?? "Asia/Riyadh";
const dayStart = Number(process.env.ZAMBAHOLA_PHASE5_DAY_START ?? 6);
const nightStart = Number(process.env.ZAMBAHOLA_PHASE5_NIGHT_START ?? 20);
const checkSec = Number(process.env.ZAMBAHOLA_PHASE5_CHECK_SEC ?? 90);
const pushMin = Number(process.env.ZAMBAHOLA_PHASE5_PUSH_MIN ?? 30);
const auditMin = Number(process.env.ZAMBAHOLA_PHASE5_AUDIT_MIN ?? 60);
const fullTrainDow = Number(process.env.ZAMBAHOLA_PHASE5_FULL_TRAIN_DOW ?? 5);
const agentCmd = process.env.ZAMBAHOLA_PHASE5_AGENT_CMD ?? "agent:phase5-ready";

let lastPush = 0;
let lastAudit = 0;
let sidecarStarted = false;
const children = [];

async function log(event, extra = {}) {
  await mkdir(dirname(logFile), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...extra }) + "\n";
  await appendFile(logFile, line, "utf8");
  console.log(`[phase5] ${event}`, Object.keys(extra).length ? extra : "");
}

async function loadState() {
  if (!existsSync(stateFile)) {
    return { lastNightTrainKey: null, nightTrainInProgress: false };
  }
  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    return { lastNightTrainKey: null, nightTrainInProgress: false };
  }
}

async function saveState(state) {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2), "utf8");
}

function localParts() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour ?? 0);
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[parts.weekday] ?? 0;
  const isNight = hour >= nightStart || hour < dayStart;
  return { hour, dateKey, dow, isNight, mode: isNight ? "night" : "day" };
}

function spawnSidecar(name, args) {
  const child = spawn(npm, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
  });
  child.on("exit", (code) => {
    console.log(`[phase5] sidecar ${name} exited ${code}`);
  });
  children.push(child);
  return child;
}

function ensureSidecars() {
  if (sidecarStarted) return;
  sidecarStarted = true;
  spawnSidecar("bridge", ["run", "agent:local-bridge"]);
  spawnSidecar("watcher", ["run", "agent:remote-watcher"]);
  spawnSidecar("guard", ["run", "agent:guard"]);
  log("sidecars_started");
}

async function agentHealthy() {
  try {
    const res = await fetch(`${agentUrl}/api/status`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const status = await res.json();
    return status?.running ? status : null;
  } catch {
    return null;
  }
}

async function stopAgent() {
  runNpm(["run", "agent:stop"], { cwd: root, stdio: "pipe" });
  await new Promise((r) => setTimeout(r, 2500));
}

async function startAgent() {
  await log("agent_start", { cmd: agentCmd });
  const child = spawn(npm, ["run", agentCmd], {
    cwd: root,
    stdio: "ignore",
    detached: true,
    shell: isWin,
  });
  child.unref();
  await new Promise((r) => setTimeout(r, 5000));
  const status = await agentHealthy();
  await log(status ? "agent_up" : "agent_start_no_status", {
    tickCount: status?.tickCount,
    feed: status?.feed,
  });
  return !!status;
}

async function runNightTrain(state, { dateKey, dow }) {
  if (state.nightTrainInProgress) return state;
  if (state.lastNightTrainKey === dateKey) return state;

  state.nightTrainInProgress = true;
  await saveState(state);
  await log("night_train_begin", { dateKey, dow });

  await stopAgent();

  spawnSync("git", ["pull", "origin", "main"], { cwd: root, stdio: "pipe" });

  const useFull = dow === fullTrainDow;
  const trainArgs = useFull
    ? ["run", "agent:omni-train"]
    : ["run", "agent:omni-train:quick"];
  await log("night_train_omni", { full: useFull });
  const train = runNpm(trainArgs, { cwd: root });
  if (!train.ok) {
    await log("night_train_failed", { step: "omni-train" });
    state.nightTrainInProgress = false;
    await saveState(state);
    await startAgent();
    return state;
  }

  const exp = runNpm(["run", "agent:export-models"], { cwd: root });
  await log(exp.ok ? "night_train_export_ok" : "night_train_export_failed");

  state.lastNightTrainKey = dateKey;
  state.nightTrainInProgress = false;
  await saveState(state);
  await log("night_train_done", { dateKey });

  await startAgent();
  return state;
}

async function ensureDayAgent() {
  const status = await agentHealthy();
  if (status) {
    await log("heartbeat", {
      tickCount: status.tickCount,
      uptimeSec: status.time?.uptimeSec,
      lastTickAgeSec: status.time?.lastTickAgeSec,
    });
    return true;
  }
  await log("agent_down_restart");
  await stopAgent();
  return startAgent();
}

async function maybePush() {
  const now = Date.now();
  if (now - lastPush < pushMin * 60_000) return;
  lastPush = now;
  const r = runNpm(["run", "agent:push-telemetry"], { cwd: root, stdio: "pipe" });
  await log(r.ok ? "telemetry_pushed" : "telemetry_failed");
}

async function maybeAudit() {
  if (auditMin <= 0) return;
  const now = Date.now();
  if (now - lastAudit < auditMin * 60_000) return;
  lastAudit = now;
  const r = runNpm(["run", "agent:log-review:apply"], { cwd: root, stdio: "pipe" });
  await log(r.ok ? "log_audit_done" : "log_audit_failed");
}

async function tick(state) {
  const parts = localParts();
  ensureSidecars();

  if (parts.isNight) {
    state = await runNightTrain(state, parts);
    if (!state.nightTrainInProgress) {
      await ensureDayAgent();
    }
  } else {
    await ensureDayAgent();
    await maybePush();
    await maybeAudit();
  }

  await saveState({ ...state, lastMode: parts.mode, lastHour: parts.hour });
  return state;
}

console.log(
  `[phase5] scheduler — tz=${tz} day=${dayStart}:00 night=${nightStart}:00 check=${checkSec}s push=${pushMin}m audit=${auditMin}m`,
);
console.log("[phase5] leave this window open — one command for day + night");

let state = await loadState();
await log("scheduler_start", { tz, dayStart, nightStart, agentCmd });

process.on("SIGINT", async () => {
  await log("scheduler_stop");
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* */
    }
  }
  process.exit(0);
});

while (true) {
  try {
    state = await tick(state);
  } catch (err) {
    await log("tick_error", { message: String(err) });
  }
  await new Promise((r) => setTimeout(r, checkSec * 1000));
}
