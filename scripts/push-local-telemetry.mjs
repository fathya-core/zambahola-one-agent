#!/usr/bin/env node
import { existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

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
    shell: process.platform === "win32",
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

function abortStuckGit() {
  const reb = git(["rev-parse", "--git-path", "rebase-merge"]).stdout?.trim();
  const reb2 = git(["rev-parse", "--git-path", "rebase-apply"]).stdout?.trim();
  if ((reb && existsSync(join(root, reb))) || (reb2 && existsSync(join(root, reb2)))) {
    console.log("[push-telemetry] aborting stuck rebase...");
    git(["rebase", "--abort"], { inherit: true });
  }
  const unmerged = (git(["diff", "--name-only", "--diff-filter=U"]).stdout ?? "").trim();
  if (unmerged) {
    console.log("[push-telemetry] clearing merge conflicts on bridge files...");
    for (const f of bridgeFiles) {
      if (existsSync(join(root, f))) git(["checkout", "--", f], { inherit: true });
    }
    git(["add", ...bridgeFiles.filter((f) => existsSync(join(root, f)))], { inherit: true });
    git(["merge", "--abort"], { inherit: true });
    git(["rebase", "--abort"], { inherit: true });
  }
}

function syncWithRemote(telemetryBackup) {
  abortStuckGit();
  console.log("[push-telemetry] syncing with origin/main...");
  git(["fetch", "origin", "main"], { inherit: true });

  const dirty = (git(["status", "--porcelain"]).stdout ?? "").trim();
  if (dirty) {
    console.log("[push-telemetry] stashing local changes before pull...");
    git(["stash", "push", "-u", "-m", "push-telemetry-auto"], { inherit: true });
  }

  const pull = git(["pull", "--rebase", "origin", "main"], { inherit: true });
  if (pull.status !== 0) {
    git(["rebase", "--abort"], { inherit: true });
    console.error("[push-telemetry] pull failed. Run manually:");
    console.error("  git stash push -u -m wip");
    console.error("  git pull origin main --rebase");
    console.error("  git stash pop");
    console.error("  npm run agent:push-telemetry");
    return false;
  }

  if (dirty) {
    const pop = git(["stash", "pop"], { inherit: true });
    if (pop.status !== 0) {
      console.log("[push-telemetry] stash pop conflict — keeping telemetry backup, dropping stash");
      git(["checkout", "--", "apps/one-agent/data/bridge/"], { inherit: true });
      git(["stash", "drop"], { inherit: true });
    }
  }

  if (existsSync(telemetryBackup)) {
    copyFileSync(telemetryBackup, telemetry);
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

const backup = join(tmpdir(), `zambahola-telemetry-${Date.now()}.json`);
if (existsSync(telemetry)) copyFileSync(telemetry, backup);

if (!syncWithRemote(backup)) process.exit(1);

const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
const files = bridgeFiles.filter((f) => existsSync(join(root, f)));

git(["add", ...files], { inherit: true });

const commit = git(["commit", "-m", `telemetry: ${ts}`]);

if (commit.status !== 0) {
  const out = (commit.stdout ?? "") + (commit.stderr ?? "");
  if (out.includes("nothing to commit")) {
    console.log("[push-telemetry] nothing new (file unchanged since last commit)");
  } else {
    console.log("[push-telemetry] nothing new — telemetry unchanged");
  }
  console.log("[push-telemetry] tip: ensure agent:local-bridge is running, then retry");
  process.exit(0);
}

const push = git(["push", "origin", "main"], { inherit: true });
process.exit(push.status ?? 0);
