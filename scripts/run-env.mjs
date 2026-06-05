#!/usr/bin/env node
/**
 * Cross-platform env + command runner (Windows-safe).
 * Usage: node scripts/run-env.mjs VAR=val VAR2=val2 -- command arg1 arg2
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 0 || sep === argv.length - 1) {
  console.error("Usage: run-env.mjs KEY=val ... [--file path.env] -- command args...");
  process.exit(1);
}

const envPart = argv.slice(0, sep);
const cmdPart = argv.slice(sep + 1);
const env = { ...process.env };

function loadEnvFile(path) {
  const text = readFileSync(resolve(path), "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
}

for (let i = 0; i < envPart.length; i++) {
  const pair = envPart[i];
  if (pair === "--file" && envPart[i + 1]) {
    loadEnvFile(envPart[i + 1]);
    i += 1;
    continue;
  }
  const eq = pair.indexOf("=");
  if (eq <= 0) continue;
  env[pair.slice(0, eq)] = pair.slice(eq + 1);
}

const [cmd, ...args] = cmdPart;
const isWin = process.platform === "win32";
const resolved = isWin && cmd === "npm" ? "npm.cmd" : cmd;

const r = spawnSync(resolved, args, {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  shell: isWin,
});

process.exit(r.status ?? 1);
