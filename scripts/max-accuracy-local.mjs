#!/usr/bin/env node
/**
 * Local machine — maximum prediction accuracy profile.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, "config", "max-accuracy.env");

function loadEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const fileEnv = loadEnvFile(envFile);
const env = { ...process.env, ...fileEnv };
const cmd = process.argv[2] ?? "train";

console.log("[max-accuracy] mode=max\n");
console.log(
  "  feed:",
  env.ZAMBAHOLA_FEED,
  "| fast:",
  env.ZAMBAHOLA_FAST,
  "| horizon:",
  env.ZAMBAHOLA_HORIZON_SEC,
  "s\n",
);

if (cmd === "start") {
  const r = spawnSync("npm", ["run", "agent:start"], {
    cwd: root,
    env: { ...env, ZAMBAHOLA_LIVE_FILTER: "1" },
    stdio: "inherit",
  });
  process.exit(r.status ?? 0);
}

const phases = [
  ["learn", ["run", "agent:learn"]],
  ["deep_learn", ["run", "agent:deep-learn"]],
  ["mega_train", ["run", "agent:mega-train"]],
  ["mega_backtest", ["run", "agent:mega-backtest"]],
  ["ultra_learn", ["run", "agent:ultra-learn"]],
  ["export", ["run", "agent:export-models"]],
];

for (const [name, args] of phases) {
  console.log(`\n[max-accuracy] === ${name} ===\n`);
  const r = spawnSync("npm", args, {
    cwd: root,
    env: { ...env, ZAMBAHOLA_FEED: "mock", ZAMBAHOLA_ACCURACY_FILTER: "off" },
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("\n[max-accuracy] Done. Live: npm run agent:max-accuracy:start\n");
