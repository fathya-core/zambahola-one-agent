#!/usr/bin/env node
/**
 * Resume learning path: start live agent (coingecko) then N learn cycles (mock).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cycles = process.env.ZAMBAHOLA_PATH_CYCLES ?? "5";
const liveFeed = process.env.ZAMBAHOLA_PATH_LIVE_FEED ?? "coingecko";

function run(label, cmd, args, env = {}) {
  console.log(`\n[path] ${label}\n`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("[path] ZAMBAHOLA — resume learning & development\n");

run("Live agent (background)", "npm", ["run", "agent:start"], {
  ZAMBAHOLA_FEED: liveFeed,
  ZAMBAHOLA_AUTO_BYBIT: "1",
});

run(`Learn ${cycles} cycles`, "npm", ["run", "agent:learn"], {
  ZAMBAHOLA_FEED: "mock",
  ZAMBAHOLA_LEARN_CYCLES: cycles,
});

console.log("\n[path] Done. Dashboard: http://127.0.0.1:8787 — agent keeps running until agent:stop\n");
