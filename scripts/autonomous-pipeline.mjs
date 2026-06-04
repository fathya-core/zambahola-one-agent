#!/usr/bin/env node
/**
 * Autonomous learning pipeline — no prompts. Runs phases sequentially.
 * Override cycles via env (defaults tuned for cloud VM).
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logDir = join(root, "apps/one-agent/data/learning");
const logFile = join(logDir, "pipeline-log.jsonl");

const env = {
  ...process.env,
  ZAMBAHOLA_AUTO_BYBIT: process.env.ZAMBAHOLA_AUTO_BYBIT ?? "1",
  ZAMBAHOLA_FEED: process.env.ZAMBAHOLA_PIPELINE_FEED ?? "mock",
  ZAMBAHOLA_LEARN_CYCLES: process.env.ZAMBAHOLA_LEARN_CYCLES ?? "15",
  ZAMBAHOLA_DEEP_CYCLES: process.env.ZAMBAHOLA_DEEP_CYCLES ?? "8",
  ZAMBAHOLA_ULTRA_CYCLES: process.env.ZAMBAHOLA_ULTRA_CYCLES ?? "6",
  ZAMBAHOLA_ULTRA_KLINES: process.env.ZAMBAHOLA_ULTRA_KLINES ?? "2500",
  ZAMBAHOLA_KLINES: process.env.ZAMBAHOLA_KLINES ?? "1500",
};

const phases = [
  ["learn", ["run", "agent:learn"]],
  ["deep_learn", ["run", "agent:deep-learn"]],
  ["mega_train", ["run", "agent:mega-train"]],
  ["mega_backtest", ["run", "agent:mega-backtest"]],
  ["ultra_learn", ["run", "agent:ultra-learn"]],
  ["export_models", ["run", "agent:export-models"]],
  ["verify", ["run", "verify"]],
];

function log(entry) {
  mkdirSync(logDir, { recursive: true });
  writeFileSync(logFile, `${JSON.stringify({ ...entry, ts: new Date().toISOString() })}\n`, {
    flag: "a",
  });
  console.log(`[pipeline] ${entry.phase} — ${entry.status}`);
}

console.log("[pipeline] ZAMBAHOLA autonomous dev — starting\n");

for (const [phase, args] of phases) {
  const t0 = Date.now();
  const r = spawnSync("npm", args, { cwd: root, env, stdio: "inherit" });
  const ok = r.status === 0;
  log({
    phase,
    status: ok ? "ok" : "fail",
    exit: r.status,
    durationMs: Date.now() - t0,
  });
  if (!ok) {
    console.error(`[pipeline] Stopped at ${phase}`);
    process.exit(r.status ?? 1);
  }
}

console.log("\n[pipeline] Complete. Log:", logFile);
