#!/usr/bin/env node
/**
 * Push LOCAL-TELEMETRY.json to GitHub.
 * Windows-safe: no path stash, uses --autostash on pull.
 */
import { existsSync, copyFileSync, readFileSync } from "node:fs";
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
    shell: false,
  });
}

async function refreshFromBridge() {
  try {
    const res = await fetch(`${bridgeUrl}/telemetry`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      console.warn(`[push-telemetry] bridge refresh HTTP ${res.status} — is local-bridge running?`);
      return false;
    }
    console.log("[push-telemetry] refreshed from bridge");
    return true;
  } catch (e) {
    console.warn(`[push-telemetry] bridge offline — run: npm run agent:local-bridge`);
    return false;
  }
}

function abortStuckRebase() {
  const reb = git(["rev-parse", "--git-path", "rebase-merge"]).stdout?.trim();
  const reb2 = git(["rev-parse", "--git-path", "rebase-apply"]).stdout?.trim();
  if ((reb && existsSync(join(root, reb))) || (reb2 && existsSync(join(root, reb2)))) {
    console.log("[push-telemetry] aborting stuck rebase...");
    git(["rebase", "--abort"], { inherit: true });
  }
}

function telemetryChanged() {
  if (!existsSync(telemetry)) return false;
  const head = git(["show", "HEAD:apps/one-agent/data/bridge/LOCAL-TELEMETRY.json"]);
  if (head.status !== 0) return true;
  try {
    return JSON.stringify(JSON.parse(head.stdout)) !== JSON.stringify(JSON.parse(readFileSync(telemetry, "utf8")));
  } catch {
    return true;
  }
}

abortStuckRebase();

if (!existsSync(telemetry)) {
  await refreshFromBridge();
  if (!existsSync(telemetry)) {
    console.error("[push-telemetry] missing — start: npm run agent:local-bridge");
    process.exit(1);
  }
} else {
  await refreshFromBridge();
}

if (!existsSync(telemetry)) {
  console.error("[push-telemetry] no telemetry file — bridge must be running on :8790");
  process.exit(1);
}

const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
const files = bridgeFiles.filter((f) => existsSync(join(root, f)));

if (!telemetryChanged()) {
  const snap = JSON.parse(readFileSync(telemetry, "utf8"));
  console.log(
    `[push-telemetry] nothing new (hostname=${snap.hostname ?? "?"}, ticks=${snap.status?.tickCount ?? "?"})`,
  );
  process.exit(0);
}

console.log("[push-telemetry] syncing with origin/main...");
git(["fetch", "origin", "main"], { inherit: true });

const pull = git(["pull", "--rebase", "--autostash", "origin", "main"], { inherit: true });
if (pull.status !== 0) {
  console.error("[push-telemetry] pull failed — run: npm run agent:fix-git-push");
  process.exit(1);
}

git(["add", "-f", ...files], { inherit: true });

const commit = git(["commit", "-m", `telemetry: ${ts}`], { inherit: true });
if (commit.status !== 0) {
  console.error("[push-telemetry] commit failed");
  process.exit(1);
}

const push = git(["push", "origin", "main"], { inherit: true });
process.exit(push.status ?? 0);
