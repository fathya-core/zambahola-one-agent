#!/usr/bin/env node
/**
 * Resume learning path: start live agent (coingecko) then N learn cycles (mock).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./lib/run-npm.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cycles = process.env.ZAMBAHOLA_PATH_CYCLES ?? "5";
const liveFeed = process.env.ZAMBAHOLA_PATH_LIVE_FEED ?? "coingecko";

function run(label, args, env = {}) {
  console.log(`\n[path] ${label}\n`);
  const r = runNpm(args, {
    cwd: root,
    env: { ...process.env, ...env },
  });
  if (!r.ok) process.exit(r.status);
}

console.log("[path] ZAMBAHOLA — resume learning & development\n");

run(["run", "agent:start"], {
  ZAMBAHOLA_FEED: liveFeed,
  ZAMBAHOLA_AUTO_BYBIT: "1",
});

run(["run", "agent:learn"], {
  ZAMBAHOLA_FEED: "mock",
  ZAMBAHOLA_LEARN_CYCLES: cycles,
});

console.log("\n[path] Done. Dashboard: http://127.0.0.1:8787 — agent keeps running until agent:stop\n");
