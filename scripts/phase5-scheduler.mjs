#!/usr/bin/env node
/**
 * Phase 5 — day/night automation (keep window open: npm run agent:phase5-auto)
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./lib/run-npm.mjs";
import { forceStopAgent } from "./phase5-agent-stop.mjs";
import { agentHealthy, startAgentDetached } from "./phase5-agent-start.mjs";

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
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

const tz = process.env.ZAMBAHOLA_PHASE5_TZ ?? "Asia/Riyadh";
const dayStart = Number(process.env.ZAMBAHOLA_PHASE5_DAY_START ?? 6);
const nightStart = Number(process.env.ZAMBAHOLA_PHASE5_NIGHT_START ?? 20);
const checkSec = Number(process.env.ZAMBAHOLA_PHASE5_CHECK_SEC ?? 90);
const pushMin = Number(process.env.ZAMBAHOLA_PHASE5_PUSH_MIN ?? 30);
const auditMin = Number(process.env.ZAMBAHOLA_PHASE5_AUDIT_MIN ?? 60);
const agentCmd = process.env.ZAMBAHOLA_PHASE5_AGENT_CMD ?? "agent:phase5-ready";

let lastPush = 0;
let lastAudit = 0;
let lastMode = "";
let tickN = 0;
let sidecarStarted = false;
const children = [];

async function log(event, extra = {}) {
  await mkdir(dirname(logFile), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...extra }) + "\n";
  await appendFile(logFile, line, "utf8");
  console.log(`[phase5] ${event}`, Object.keys(extra).length ? extra : "");
}

const staleNightTrainMs =
  Number(process.env.ZAMBAHOLA_PHASE5_STALE_TRAIN_MIN ?? 45) * 60_000;

function normalizeState(raw) {
  const state = {
    lastNightTrainKey: null,
    nightTrainInProgress: false,
    ...(raw && typeof raw === "object" ? raw : {}),
  };
  if (state.nightTrainInProgress) {
    const updated = Number(state.updatedAt ?? 0);
    if (!updated || Date.now() - updated > staleNightTrainMs) {
      state.nightTrainInProgress = false;
      state._staleTrainCleared = true;
    }
  }
  return state;
}

async function loadState() {
  if (!existsSync(stateFile)) {
    return { lastNightTrainKey: null, nightTrainInProgress: false };
  }
  try {
    return normalizeState(JSON.parse(await readFile(stateFile, "utf8")));
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
    hourCycle: "h23",
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
    stdio: "ignore",
    shell: isWin,
    detached: false,
  });
  child.on("exit", (code) => {
    console.log(`[phase5] sidecar ${name} exited ${code}`);
  });
  children.push(child);
  return child;
}

async function ensureSidecars() {
  if (sidecarStarted) return;
  sidecarStarted = true;
  spawnSidecar("bridge", ["run", "agent:local-bridge"]);
  spawnSidecar("watcher", ["run", "agent:remote-watcher"]);
  spawnSidecar("guard", ["run", "agent:guard"]);
  await log("sidecars_started");
}

async function stopAgent() {
  const ok = await forceStopAgent(4);
  await log(ok ? "agent_stopped" : "agent_stop_incomplete");
  return ok;
}

async function startAgent() {
  await log("agent_start", { cmd: agentCmd });
  const r = await startAgentDetached(agentCmd);
  const status = r.status;
  await log(r.ok ? "agent_up" : "agent_start_no_status", {
    tickCount: status?.tickCount,
    pid: status?.pid,
    feed: status?.feed,
  });
  return r.ok;
}

async function runNightTrain(state, parts) {
  if (state.nightTrainInProgress) {
    await log("night_train_skip", { reason: "in_progress" });
    return state;
  }
  if (state.lastNightTrainKey === parts.dateKey) {
    await log("night_train_skip", { reason: "already_done", dateKey: parts.dateKey });
    return state;
  }

  state.nightTrainInProgress = true;
  await saveState(state);
  await log("night_train_begin", { dateKey: parts.dateKey, hour: parts.hour, dow: parts.dow });

  const r = spawnSync(process.execPath, [join(root, "scripts/phase5-night-train.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  if (r.status === 0) {
    state.lastNightTrainKey = parts.dateKey;
    await log("night_train_done", { dateKey: parts.dateKey });
  } else {
    await log("night_train_failed", { exit: r.status ?? 1 });
  }

  state.nightTrainInProgress = false;
  await saveState(state);

  if (!(await agentHealthy())) {
    await startAgent();
  }
  return state;
}

async function ensureDayAgent() {
  const status = await agentHealthy();
  if (status) {
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
  tickN += 1;
  const parts = localParts();
  await ensureSidecars();

  if (parts.mode !== lastMode) {
    lastMode = parts.mode;
    await log("mode_change", { mode: parts.mode, hour: parts.hour, dateKey: parts.dateKey });
  }

  if (tickN % 5 === 1) {
    await log("tick", {
      n: tickN,
      mode: parts.mode,
      hour: parts.hour,
      isNight: parts.isNight,
      lastNightTrainKey: state.lastNightTrainKey,
    });
  }

  if (parts.isNight) {
    state = await runNightTrain(state, parts);
    if (!state.nightTrainInProgress && !(await agentHealthy())) {
      await ensureDayAgent();
    } else if (await agentHealthy()) {
      const s = await agentHealthy();
      if (tickN % 5 === 1) {
        await log("heartbeat", {
          tickCount: s?.tickCount,
          uptimeSec: s?.time?.uptimeSec,
        });
      }
      await maybePush();
      await maybeAudit();
    }
  } else {
    const up = await ensureDayAgent();
    if (up) {
      const s = await agentHealthy();
      if (tickN % 5 === 1 && s) {
        await log("heartbeat", {
          tickCount: s.tickCount,
          uptimeSec: s.time?.uptimeSec,
          lastTickAgeSec: s.time?.lastTickAgeSec,
        });
      }
    }
    await maybePush();
    await maybeAudit();
  }

  await saveState({
    ...state,
    lastMode: parts.mode,
    lastHour: parts.hour,
    lastDateKey: parts.dateKey,
  });
  return state;
}

console.log(
  `[phase5] scheduler — tz=${tz} day=${dayStart}:00 night=${nightStart}:00 check=${checkSec}s push=${pushMin}m audit=${auditMin}m`,
);
console.log("[phase5] leave this window open — one command for day + night");

let state = await loadState();
if (state._staleTrainCleared) {
  delete state._staleTrainCleared;
  await saveState(state);
  await log("stale_night_train_cleared");
}
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

process.on("uncaughtException", async (err) => {
  await log("uncaught_exception", { message: String(err) });
});

process.on("unhandledRejection", async (err) => {
  await log("unhandled_rejection", { message: String(err) });
});

while (true) {
  try {
    state = await tick(state);
  } catch (err) {
    await log("tick_error", { message: String(err) });
  }
  await new Promise((r) => setTimeout(r, checkSec * 1000));
}
