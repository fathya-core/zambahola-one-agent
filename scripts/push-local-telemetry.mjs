#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const telemetry = join(root, "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json");
const bridgeUrl = process.env.ZAMBAHOLA_BRIDGE_URL ?? "http://127.0.0.1:8790";

async function refreshFromBridge() {
  try {
    const res = await fetch(`${bridgeUrl}/telemetry`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      console.warn(`[push-telemetry] bridge refresh HTTP ${res.status} — using file on disk`);
      return false;
    }
    console.log("[push-telemetry] refreshed from bridge");
    return true;
  } catch (e) {
    console.warn(`[push-telemetry] bridge unreachable (${e.message}) — using file on disk`);
    return false;
  }
}

if (!existsSync(telemetry)) {
  const refreshed = await refreshFromBridge();
  if (!refreshed && !existsSync(telemetry)) {
    console.error("[push-telemetry] missing — run: npm run agent:local-bridge");
    process.exit(1);
  }
} else {
  await refreshFromBridge();
}

const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
const files = [
  "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json",
  "apps/one-agent/data/bridge/REMOTE-COMMANDS.json",
  "apps/one-agent/data/bridge/REMOTE-COMMANDS-DONE.json",
];

spawnSync("git", ["add", ...files.filter((f) => existsSync(join(root, f)))], {
  cwd: root,
  stdio: "inherit",
});

const commit = spawnSync(
  "git",
  ["commit", "-m", `telemetry: ${ts}`],
  { cwd: root, stdio: "pipe", encoding: "utf8" },
);

if (commit.status !== 0) {
  console.log("[push-telemetry] nothing new (file unchanged since last commit)");
  console.log("[push-telemetry] tip: ensure agent:local-bridge is running, then retry");
  process.exit(0);
}

const push = spawnSync("git", ["push", "origin", "main"], {
  cwd: root,
  stdio: "inherit",
});
process.exit(push.status ?? 0);
