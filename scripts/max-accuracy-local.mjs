#!/usr/bin/env node
/**
 * Local machine — maximum prediction accuracy profile.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./lib/run-npm.mjs";

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
const baseEnv = { ...process.env, ...fileEnv };
const cmd = process.argv[2] ?? "train";
const quick = process.argv.includes("--quick");

if (quick) {
  baseEnv.ZAMBAHOLA_LEARN_CYCLES = "2";
  baseEnv.ZAMBAHOLA_DEEP_CYCLES = "2";
  baseEnv.ZAMBAHOLA_ULTRA_CYCLES = "2";
  baseEnv.ZAMBAHOLA_ULTRA_KLINES = "400";
  baseEnv.ZAMBAHOLA_KLINES = "300";
}

if (cmd === "start") {
  console.log("[max-accuracy] Starting live agent (max mode)\n");
  const r = runNpm(["run", "agent:start"], {
    cwd: root,
    env: { ...baseEnv, ZAMBAHOLA_LIVE_FILTER: "1" },
  });
  process.exit(r.status);
}

console.log("[max-accuracy] mode=max", quick ? "(quick test)" : "", "\n");
console.log(
  "  feed:",
  baseEnv.ZAMBAHOLA_FEED,
  "| fast:",
  baseEnv.ZAMBAHOLA_FAST,
  "| horizon:",
  baseEnv.ZAMBAHOLA_HORIZON_SEC,
  "s",
);
console.log(
  "  learn cycles:",
  baseEnv.ZAMBAHOLA_LEARN_CYCLES,
  "(each ~65s — do not close this window)\n",
);

const trainEnv = {
  ...baseEnv,
  ZAMBAHOLA_FEED: "mock",
  ZAMBAHOLA_ACCURACY_FILTER: "off",
};

const phases = [
  ["learn", ["run", "agent:learn"]],
  ["deep_learn", ["run", "agent:deep-learn"]],
  ["mega_train", ["run", "agent:mega-train"]],
  ["ultra_learn", ["run", "agent:ultra-learn"]],
  ["export", ["run", "agent:export-models"]],
];

for (const [name, args] of phases) {
  console.log(`\n[max-accuracy] === ${name} ===\n`);
  const r = runNpm(args, { cwd: root, env: trainEnv });
  if (!r.ok) process.exit(r.status);
}

console.log("\n[max-accuracy] Done. Live: npm run agent:max-accuracy:start\n");
