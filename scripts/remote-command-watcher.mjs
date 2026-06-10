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

const BLOCKED_WHEN_SAFE = new Set([
  "stop",
  "phase4-hit-recover",
  "phase5-reload",
  "phase5-ready",
  "phase5-auto",
  "dl-nightly",
  "phase2-live",
  "phase2-signals",
  "experiments",
]);

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
  "phase5-ready": ["run", "agent:phase5-ready"],
  "phase5-reload": ["run", "agent:phase5-reload"],
  "phase5-auto": ["run", "agent:phase5-scheduler"],
  "dl-nightly": ["run", "agent:dl-nightly"],
  "import-hf-research": ["run", "agent:import-hf-research"],
};

const watcherSafe = process.env.ZAMBAHOLA_WATCHER_SAFE === "1";

function runNpm(args) {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const command = isWin ? "cmd.exe" : "npm";
    const argv = isWin ? ["/d", "/s", "/c", "npm", ...args] : args;
    const child = spawn(command, argv, {
      cwd: root,
      stdio: "inherit",
      windowsHide: isWin,
      shell: false,
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
    if (watcherSafe && BLOCKED_WHEN_SAFE.has(cmd.action)) {
      console.log(`[watcher] SKIP (safe mode) ${cmd.action} (${cmd.id})`);
      done.push({
        ...cmd,
        completedAt: new Date().toISOString(),
        exit: -1,
        skipped: "watcher_safe",
      });
      continue;
    }
    console.log(`[watcher] run ${cmd.action} (${cmd.id})`);
    let exit = 0;
    if (args) exit = await runNpm(args);
    else console.log(`[watcher] unknown action: ${cmd.action}`);
    done.push({ ...cmd, completedAt: new Date().toISOString(), exit });
  }

  await writeFile(doneFile, JSON.stringify(done.slice(-100), null, 2), "utf8");
}

console.log(
  `[watcher] remote commands → ${commandsFile}${watcherSafe ? " (SAFE: no stop/reload)" : ""}`,
);
setInterval(() => void tick(), 15_000);
void tick();
