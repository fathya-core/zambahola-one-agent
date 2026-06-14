#!/usr/bin/env node
/** Start agent detached (Windows-safe) and wait for /api/status */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "../core/lib/run-npm.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const agentUrl = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";

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

  // `npm run <cmd>` invokes cli/start.ts, which itself spawns the agent runner
  // detached (unref) and returns after ~2s. Running it to completion here is far
  // more reliable on Windows than `cmd /c start /B`, which often fails to launch.
  const r = runNpm(["run", cmd], { cwd: root, stdio: "inherit" });
  if (!r.ok) {
    console.error(`[phase5-start] launcher exited ${r.status}`);
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
