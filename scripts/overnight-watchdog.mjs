#!/usr/bin/env node
/**
 * Overnight watchdog — keeps learn-trade agent alive + auto telemetry push.
 * Run via: npm run agent:overnight-learn
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./lib/run-npm.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logFile = join(root, "apps/one-agent/data/bridge/OVERNIGHT-LOG.jsonl");
const agentUrl = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";
const hours = Number(process.env.ZAMBAHOLA_OVERNIGHT_HOURS ?? 8);
const checkSec = Number(process.env.ZAMBAHOLA_OVERNIGHT_CHECK_SEC ?? 90);
const pushMin = Number(process.env.ZAMBAHOLA_OVERNIGHT_PUSH_MIN ?? 45);
const startCmd = process.env.ZAMBAHOLA_OVERNIGHT_START ?? "agent:phase2-hybrid";

const endAt = Date.now() + hours * 3600_000;
let lastPush = 0;
let restarts = 0;

async function log(event, extra = {}) {
  await mkdir(dirname(logFile), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...extra }) + "\n";
  await appendFile(logFile, line, "utf8");
  console.log(`[overnight] ${event}`, extra.status ? extra : "");
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

async function startAgent() {
  console.log(`[overnight] starting ${startCmd}...`);
  const r = runNpm(["run", startCmd], { cwd: root });
  if (!r.ok) {
    await log("start_failed", { cmd: startCmd });
    return false;
  }
  await new Promise((r) => setTimeout(r, 4000));
  const status = await agentHealthy();
  if (status) {
    restarts += 1;
    await log("agent_started", {
      cmd: startCmd,
      tickCount: status.tickCount,
      feed: status.feed,
      restarts,
    });
    return true;
  }
  await log("start_no_status", { cmd: startCmd });
  return false;
}

async function ensureAgent() {
  const status = await agentHealthy();
  if (status) {
    await log("heartbeat", {
      tickCount: status.tickCount,
      feed: status.feed,
      horizonSec: status.horizonSec,
      uptimeSec: status.time?.uptimeSec,
    });
    return true;
  }
  await log("agent_down_restarting");
  runNpm(["run", "agent:stop"], { cwd: root, stdio: "pipe" });
  return startAgent();
}

async function maybePushTelemetry() {
  const now = Date.now();
  if (now - lastPush < pushMin * 60_000) return;
  lastPush = now;
  console.log("[overnight] push telemetry...");
  const r = runNpm(["run", "agent:push-telemetry"], { cwd: root, stdio: "pipe" });
  await log(r.ok ? "telemetry_pushed" : "telemetry_push_failed");
}

console.log(`[overnight] ZAMBAHOLA watchdog — ${hours}h, check every ${checkSec}s, push every ${pushMin}m`);
await log("watchdog_start", { hours, checkSec, pushMin, startCmd });

runNpm(["run", "agent:stop"], { cwd: root, stdio: "pipe" });
await startAgent();

while (Date.now() < endAt) {
  await ensureAgent();
  await maybePushTelemetry();
  await new Promise((r) => setTimeout(r, checkSec * 1000));
}

await maybePushTelemetry();
await log("watchdog_done", { restarts, note: "agent still running — check dashboard in morning" });
console.log(`[overnight] Done (${hours}h). Agent still running. Log: apps/one-agent/data/bridge/OVERNIGHT-LOG.jsonl`);
