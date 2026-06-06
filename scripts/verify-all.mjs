#!/usr/bin/env node
/**
 * Full repo verification — run in CI / cloud VM
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { runNpm } from "./lib/run-npm.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = { ok: true, checks: [], ts: new Date().toISOString() };

function run(name, npmArgs, env = {}) {
  const r = runNpm(npmArgs, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "pipe",
  });
  const pass = r.ok;
  if (!pass) report.ok = false;
  report.checks.push({
    name,
    pass,
    exit: r.status,
    out: "",
  });
  console.log(pass ? `✓ ${name}` : `✗ ${name}`);
  return pass;
}

console.log("[verify] ZAMBAHOLA full verification\n");

run("setup", ["run", "setup"]);
{
  const stratDir = join(root, "apps/one-agent/src/prediction-engine/strategies");
  const files = readdirSync(stratDir).filter(
    (f) => f.endsWith(".ts") && f !== "types.ts" && f !== "index.ts",
  );
  const pass = files.length === 17;
  if (!pass) report.ok = false;
  report.checks.push({ name: "strategy_count", pass, count: files.length });
  console.log(pass ? `✓ strategy_count (${files.length})` : `✗ strategy_count (${files.length})`);
}

run("test_run", ["run", "agent:test-run"], { ZAMBAHOLA_FEED: "mock" });
run("mega_train", ["run", "agent:mega-train"], {
  ZAMBAHOLA_KLINES: "300",
});

const required = [
  "apps/one-agent/src/prediction-engine/index.ts",
  "apps/one-agent/src/cli/ultra-learn.ts",
  "docs/ZAMBAHOLA_V07.md",
  "apps/one-agent/src/market-feed/bybit-primary-feed.ts",
  "package.json",
];
for (const f of required) {
  const pass = existsSync(join(root, f));
  if (!pass) report.ok = false;
  report.checks.push({ name: `file:${f}`, pass });
  console.log(pass ? `✓ ${f}` : `✗ ${f}`);
}

const out = join(root, "docs/VERIFICATION_REPORT.json");
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
console.log("\n", JSON.stringify({ ok: report.ok, checks: report.checks.length }, null, 2));
process.exit(report.ok ? 0 : 1);
