#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { refreshTelemetry } from "./collect-telemetry.mjs";
import { finishScript } from "./lib/safe-fetch.mjs";
import { formatLocalNow } from "./time-local.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const telemetry = join(root, "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json");
const bridgeFiles = [
  "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json",
  "apps/one-agent/data/bridge/REMOTE-COMMANDS.json",
  "apps/one-agent/data/bridge/REMOTE-COMMANDS-DONE.json",
  "apps/one-agent/data/bridge/PHASE5-SCHEDULER.jsonl",
  "apps/one-agent/data/bridge/PHASE5-STATE.json",
];

function git(args, opts = {}) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: opts.inherit ? "inherit" : "pipe",
    shell: false,
  });
}

function abortStuckRebase() {
  const reb = git(["rev-parse", "--git-path", "rebase-merge"]).stdout?.trim();
  const reb2 = git(["rev-parse", "--git-path", "rebase-apply"]).stdout?.trim();
  if ((reb && existsSync(join(root, reb))) || (reb2 && existsSync(join(root, reb2)))) {
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

async function main() {
  abortStuckRebase();

  const ok = await refreshTelemetry();
  if (!ok) {
    console.error("[push-telemetry] start agent: npm run agent:phase4-hit-recover");
    return 1;
  }

  if (!telemetryChanged()) {
    const snap = JSON.parse(readFileSync(telemetry, "utf8"));
    console.log(
      `[push-telemetry] nothing new (hostname=${snap.hostname ?? "?"}, ticks=${snap.status?.tickCount ?? "?"})`,
    );
    return 0;
  }

  const ts = formatLocalNow().slice(0, 16);
  const files = bridgeFiles.filter((f) => existsSync(join(root, f)));

  console.log("[push-telemetry] syncing with origin/main...");
  git(["fetch", "origin", "main"], { inherit: true });
  const pull = git(["pull", "--rebase", "--autostash", "origin", "main"], { inherit: true });
  if (pull.status !== 0) {
    console.error("[push-telemetry] pull failed — run: npm run agent:fix-git-push");
    return 1;
  }

  git(["add", "-f", ...files], { inherit: true });
  const commit = git(["commit", "-m", `telemetry: ${ts}`], { inherit: true });
  if (commit.status !== 0) return 1;

  const push = git(["push", "origin", "main"], { inherit: true });
  return push.status ?? 0;
}

main()
  .then((code) => finishScript(code))
  .catch((err) => {
    console.error("[push-telemetry] error:", err);
    finishScript(1);
  });
