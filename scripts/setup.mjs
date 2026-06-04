#!/usr/bin/env node
/**
 * Bootstrap dependencies without a global pnpm install.
 * 1) Use pnpm if already on PATH
 * 2) Else enable pnpm via Corepack (Node 20+)
 * 3) Else run via npx pnpm@9.15.0
 */
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PNPM_VERSION = "9.15.0";

function run(cmd, args = []) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

function tryExec(cmd) {
  try {
    execSync(cmd, { stdio: "ignore", cwd: root });
    return true;
  } catch {
    return false;
  }
}

function pnpmInstall(via) {
  console.log(`[zambahola] Running ${via} install…\n`);
  if (via === "pnpm") {
    run("pnpm", ["install"]);
  } else {
    run("npx", [`pnpm@${PNPM_VERSION}`, "install"]);
  }
}

console.log("[zambahola] Setting up dependencies…\n");

if (tryExec("pnpm --version")) {
  pnpmInstall("pnpm");
} else if (tryExec("corepack --version")) {
  console.log("[zambahola] Enabling pnpm via Corepack…");
  run("corepack", ["enable"]);
  run("corepack", ["prepare", `pnpm@${PNPM_VERSION}`, "--activate"]);
  if (tryExec("pnpm --version")) {
    pnpmInstall("pnpm");
  } else {
    console.log("[zambahola] Corepack did not expose pnpm — using npx…");
    pnpmInstall("npx pnpm");
  }
} else {
  console.log("[zambahola] Using npx pnpm (no global install)…");
  pnpmInstall("npx pnpm");
}

console.log("\n[zambahola] Done. Run: npm run agent:start");
