#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const telemetry = join(root, "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json");
const bridgeUrl = process.env.ZAMBAHOLA_BRIDGE_URL ?? "http://127.0.0.1:8790";
const bridgeFiles = [
  "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json",
  "apps/one-agent/data/bridge/REMOTE-COMMANDS.json",
  "apps/one-agent/data/bridge/REMOTE-COMMANDS-DONE.json",
];

function git(args, opts = {}) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: opts.inherit ? "inherit" : "pipe",
    ...opts,
  });
}

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

function syncWithRemote() {
  console.log("[push-telemetry] syncing with origin/main...");
  git(["fetch", "origin", "main"], { inherit: true });

  const pull = git(["pull", "--rebase", "origin", "main"], { inherit: true });
  if (pull.status === 0) return true;

  const status = git(["status", "--porcelain"]).stdout ?? "";
  const conflicted = bridgeFiles.some((f) => status.includes(f));
  if (!conflicted) {
    console.error("[push-telemetry] git pull failed — run: git pull --rebase origin main");
    return false;
  }

  console.log("[push-telemetry] resolving bridge file conflicts (keeping your local telemetry)...");
  for (const f of bridgeFiles) {
    if (existsSync(join(root, f))) {
      git(["checkout", "--ours", f]);
      git(["add", f]);
    }
  }
  const cont = git(["rebase", "--continue"], { inherit: true });
  if (cont.status !== 0) {
    git(["rebase", "--abort"], { inherit: true });
    console.error("[push-telemetry] rebase failed — run manually:");
    console.error("  git pull --rebase origin main");
    console.error("  git checkout --ours apps/one-agent/data/bridge/LOCAL-TELEMETRY.json");
    console.error("  git add apps/one-agent/data/bridge/LOCAL-TELEMETRY.json");
    console.error("  git rebase --continue");
    return false;
  }
  return true;
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

if (!syncWithRemote()) process.exit(1);

const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
const files = bridgeFiles.filter((f) => existsSync(join(root, f)));

git(["add", ...files], { inherit: true });

const commit = git(["commit", "-m", `telemetry: ${ts}`]);

if (commit.status !== 0) {
  console.log("[push-telemetry] nothing new (file unchanged since last commit)");
  console.log("[push-telemetry] tip: ensure agent:local-bridge is running, then retry");
  process.exit(0);
}

const push = git(["push", "origin", "main"], { inherit: true });
process.exit(push.status ?? 0);
