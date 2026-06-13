#!/usr/bin/env node
/** Start agent detached (Windows-safe) and wait for /api/status */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const agentUrl = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

export async function agentHealthy() {
  try {
    const res = await fetch(`${agentUrl}/api/status`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const status = await res.json();
    return status?.running ? status : null;
  } catch {
    return null;
  }
}

export async function startAgentDetached(
  cmd = process.env.ZAMBAHOLA_PHASE5_AGENT_CMD ?? "agent:phase5-ready",
  { waitSec = 30 } = {},
) {
  console.log(`[phase5-start] launching ${cmd}...`);

  if (isWin) {
    // detached + shell:true is unreliable on Windows; use cmd start /B
    spawnSync("cmd.exe", ["/c", "start", "zambahola-agent", "/B", npm, "run", cmd], {
      cwd: root,
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    const child = spawn(npm, ["run", cmd], {
      cwd: root,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  const attempts = Math.max(1, Math.ceil(waitSec / 3));
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await agentHealthy();
    if (status) {
      console.log(`[phase5-start] agent up pid=${status.pid} ticks=${status.tickCount}`);
      return { ok: true, status };
    }
  }

  console.error("[phase5-start] agent not responding on :8787 after start");
  return { ok: false, status: null };
}

if (process.argv[1]?.endsWith("phase5-agent-start.mjs")) {
  const cmd = process.argv[2] ?? process.env.ZAMBAHOLA_PHASE5_AGENT_CMD ?? "agent:phase5-ready";
  const r = await startAgentDetached(cmd);
  process.exit(r.ok ? 0 : 1);
}
