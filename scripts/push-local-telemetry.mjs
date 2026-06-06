#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const telemetry = join(root, "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json");

if (!existsSync(telemetry)) {
  console.error("[push-telemetry] missing — run: npm run agent:local-bridge");
  process.exit(1);
}

const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
const files = [
  "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json",
  "apps/one-agent/data/bridge/REMOTE-COMMANDS.json",
];

spawnSync("git", ["add", ...files.filter((f) => existsSync(join(root, f)))], {
  cwd: root,
  stdio: "inherit",
});

const commit = spawnSync(
  "git",
  ["commit", "-m", `telemetry: ${ts}`],
  { cwd: root, stdio: "pipe", encoding: "utf8" },
);

if (commit.status !== 0) {
  console.log("[push-telemetry] nothing new");
  process.exit(0);
}

const push = spawnSync("git", ["push", "origin", "main"], {
  cwd: root,
  stdio: "inherit",
});
process.exit(push.status ?? 0);
