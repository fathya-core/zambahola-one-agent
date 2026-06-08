#!/usr/bin/env node
/**
 * Watches REMOTE-COMMANDS.json and runs npm actions locally.
 * Cloud agent queues via bridge POST /command or commits to git.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const commandsFile = join(root, "apps/one-agent/data/bridge/REMOTE-COMMANDS.json");
const doneFile = join(root, "apps/one-agent/data/bridge/REMOTE-COMMANDS-DONE.json");

const ACTION_MAP = {
  "research-import": ["run", "agent:research-import", "--", "apps/one-agent/knowledge/user-reports/AGENT-IMPORT-FINAL.json"],
  stop: ["run", "agent:stop"],
  "phase2-live": ["run", "agent:phase2-live"],
  "phase2-signals": ["run", "agent:phase2-signals"],
  patterns: ["run", "agent:patterns"],
  "log-review": ["run", "agent:log-review"],
  "log-review:apply": ["run", "agent:log-review:apply"],
  experiments: ["run", "agent:experiments:quick"],
  "push-telemetry": ["run", "agent:push-telemetry"],
  "health-check": ["run", "agent:health-check"],
  "phase4-hit-recover": ["run", "agent:phase4-hit-recover"],
  "dl-nightly": ["run", "agent:dl-nightly"],
};

function runNpm(args) {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const child = spawn(isWin ? "npm.cmd" : "npm", args, {
      cwd: root,
      stdio: "inherit",
      shell: isWin,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

async function tick() {
  const pending = await loadJson(commandsFile, []);
  const done = await loadJson(doneFile, []);
  const unprocessed = pending.filter((c) => !done.some((d) => d.id === c.id));
  if (!unprocessed.length) return;

  for (const cmd of unprocessed) {
    const args = ACTION_MAP[cmd.action];
    console.log(`[watcher] run ${cmd.action} (${cmd.id})`);
    let exit = 0;
    if (args) exit = await runNpm(args);
    else console.log(`[watcher] unknown action: ${cmd.action}`);
    done.push({ ...cmd, completedAt: new Date().toISOString(), exit });
  }

  await writeFile(doneFile, JSON.stringify(done.slice(-100), null, 2), "utf8");
}

console.log("[watcher] remote commands →", commandsFile);
setInterval(() => void tick(), 15_000);
void tick();
