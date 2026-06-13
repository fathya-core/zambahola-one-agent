#!/usr/bin/env node
/** Sidecars + agent watch — stays connected, no night train (Windows) */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const isWin = process.platform === "win32";

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

const phase5Env = loadEnvFile(join(root, "config", "phase5-ready.env"));
const childEnv = {
  ...process.env,
  ...phase5Env,
  ZAMBAHOLA_GUARD_RESTART: "phase5-reload",
  ZAMBAHOLA_WATCHER_SAFE: "1",
  ZAMBAHOLA_GUARD_PASSIVE: "1",
  ZAMBAHOLA_ANALYST_NO_RELOAD: "1",
};

function spawnNpm(name, args) {
  const command = isWin ? "cmd.exe" : "npm";
  const argv = isWin ? ["/d", "/s", "/c", "npm", ...args] : args;
  const child = spawn(command, argv, {
    cwd: root,
    env: childEnv,
    stdio: "ignore",
    windowsHide: isWin,
    shell: false,
    detached: false,
  });
  child.on("exit", (code) => console.log(`[phase5-stable] ${name} exited ${code}`));
  return child;
}

const children = [
  spawnNpm("bridge", ["run", "agent:local-bridge"]),
  spawnNpm("watcher", ["run", "agent:remote-watcher"]),
  spawnNpm("guard", ["run", "agent:guard"]),
];

console.log("[phase5-stable] bridge + watcher + guard started");
console.log("[phase5-stable] agent watch foreground — do NOT close this window");

process.on("SIGINT", () => {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* */
    }
  }
  process.exit(0);
});

const watch = spawn(process.execPath, [join(root, "scripts/phase5/phase5-agent-watch.mjs")], {
  cwd: root,
  env: childEnv,
  stdio: "inherit",
});
watch.on("exit", (code) => process.exit(code ?? 0));
