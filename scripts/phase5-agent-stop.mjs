#!/usr/bin/env node
/** Force-stop agent (Windows-safe) before night train */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./lib/run-npm.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pidFile = join(root, "apps/one-agent/data/agent.pid");
const statusFile = join(root, "apps/one-agent/data/agent-status.json");
const agentUrl = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";
const isWin = process.platform === "win32";

function killPid(pid) {
  if (!pid || !Number.isFinite(pid)) return;
  if (isWin) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "pipe" });
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* */
    }
  }
}

async function agentUp() {
  try {
    const res = await fetch(`${agentUrl}/api/status`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const j = await res.json();
    return !!j?.running;
  } catch {
    return false;
  }
}

export async function forceStopAgent(maxAttempts = 4) {
  for (let i = 0; i < maxAttempts; i++) {
    runNpm(["run", "agent:stop"], { cwd: root, stdio: "pipe" });

    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8"));
      killPid(pid);
      try {
        unlinkSync(pidFile);
      } catch {
        /* */
      }
    }
    if (existsSync(statusFile)) {
      try {
        unlinkSync(statusFile);
      } catch {
        /* */
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
    if (!(await agentUp())) return true;
  }
  return !(await agentUp());
}

if (process.argv[1]?.endsWith("phase5-agent-stop.mjs")) {
  const ok = await forceStopAgent();
  process.exit(ok ? 0 : 1);
}
