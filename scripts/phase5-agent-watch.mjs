#!/usr/bin/env node
/** Keep phase5 agent alive — restart phase5-ready if :8787 drops (Windows OMAR-PC) */
import { appendFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentHealthy, startAgentDetached } from "./phase5-agent-start.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logFile = join(root, "apps/one-agent/data/bridge/PHASE5-WATCH.jsonl");
const pollSec = Number(process.env.ZAMBAHOLA_PHASE5_WATCH_SEC ?? 45);
const agentCmd = process.env.ZAMBAHOLA_PHASE5_AGENT_CMD ?? "agent:phase5-ready";

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

async function log(event, extra = {}) {
  await mkdir(dirname(logFile), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...extra }) + "\n";
  await appendFile(logFile, line, "utf8");
  console.log(`[phase5-watch] ${event}`, Object.keys(extra).length ? extra : "");
}

console.log(`[phase5-watch] keeping agent alive every ${pollSec}s (no night train kill)`);

async function tick() {
  const status = await agentHealthy();
  if (status) {
    if (status.tickCount % 200 < 5) {
      await log("heartbeat", {
        tickCount: status.tickCount,
        uptimeSec: status.time?.uptimeSec,
        pid: status.pid,
      });
    }
    return;
  }
  await log("agent_down");
  const r = await startAgentDetached(agentCmd);
  await log(r.ok ? "agent_restarted" : "agent_restart_failed", {
    pid: r.status?.pid,
    tickCount: r.status?.tickCount,
  });
}

await tick();
setInterval(() => void tick().catch((e) => log("tick_error", { message: String(e) })), pollSec * 1000);
