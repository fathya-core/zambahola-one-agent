#!/usr/bin/env node
/** Quick Windows-safe checks before overnight phase5-sleep */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./lib/run-npm.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

function ok(name, detail = "") {
  console.log(`[preflight] OK ${name}${detail ? ` — ${detail}` : ""}`);
}

function bad(name, detail = "") {
  console.error(`[preflight] FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  failed += 1;
}

console.log("[preflight] === phase5 sleep checks ===\n");

for (const f of [
  "scripts/lib/run-npm.mjs",
  "scripts/phase5-reset-night.mjs",
  "scripts/phase5-night-train.mjs",
  "scripts/phase5-night-verify.mjs",
  "config/phase5-night-train.env",
  "config/phase5-ready.env",
]) {
  if (existsSync(join(root, f))) ok(`file:${f}`);
  else bad(`file:${f}`, "missing");
}

const env = readFileSync(join(root, "config/phase5-night-train.env"), "utf8");
if (env.includes("ULTRA_CYCLES=16") && env.includes("OMNI_EPOCHS=2")) {
  ok("night-strong-profile");
} else {
  bad("night-strong-profile", "expected 16 ultra / 2 epochs");
}

const npmTest = runNpm(["--version"], { cwd: root, stdio: "pipe" });
if (npmTest.ok) ok("npm-spawn", "cmd.exe /c npm");
else bad("npm-spawn", "EINVAL? update git pull");

const statePath = join(root, "apps/one-agent/data/bridge/PHASE5-STATE.json");
if (existsSync(statePath)) {
  try {
    const s = JSON.parse(readFileSync(statePath, "utf8"));
    if (!s.lastNightTrainKey) ok("night-state", "lastNightTrainKey=null");
    else bad("night-state", `still ${s.lastNightTrainKey} — run reset-night`);
  } catch {
    bad("night-state", "invalid json");
  }
} else {
  ok("night-state", "no file (fresh)");
}

console.log(failed === 0 ? "\n[preflight] PASS\n" : `\n[preflight] FAIL (${failed})\n`);
process.exit(failed === 0 ? 0 : 1);
