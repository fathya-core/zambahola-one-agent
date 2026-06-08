#!/usr/bin/env node
/**
 * One command: bridge + remote-watcher + agent-guard (OMAR-PC sidecar).
 * Agent itself runs separately: npm run agent:phase4-hit-recover
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

const procs = [
  { name: "bridge", args: ["run", "agent:local-bridge"] },
  { name: "watcher", args: ["run", "agent:remote-watcher"] },
  { name: "guard", args: ["run", "agent:guard"] },
];

function startOne({ name, args }) {
  const child = spawn(npm, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
  });
  child.on("exit", (code) => {
    console.log(`[live-stack] ${name} exited ${code}`);
  });
  return child;
}

console.log("[live-stack] starting bridge + remote-watcher + guard");
console.log("[live-stack] agent must run in another terminal: npm run agent:phase4-hit-recover");

for (const p of procs) startOne(p);

process.on("SIGINT", () => process.exit(0));
