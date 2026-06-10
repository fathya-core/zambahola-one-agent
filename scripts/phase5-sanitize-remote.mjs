#!/usr/bin/env node
/** Archive destructive remote commands that kill the live agent (Windows OMAR-PC) */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const commandsFile = join(root, "apps/one-agent/data/bridge/REMOTE-COMMANDS.json");
const archiveFile = join(root, "apps/one-agent/data/bridge/REMOTE-COMMANDS-ARCHIVED.json");
const doneFile = join(root, "apps/one-agent/data/bridge/REMOTE-COMMANDS-DONE.json");

const BLOCKED = new Set([
  "stop",
  "phase4-hit-recover",
  "phase5-reload",
  "phase5-ready",
  "phase5-auto",
  "dl-nightly",
  "phase2-live",
  "phase2-signals",
  "experiments",
]);

const SAFE = new Set(["push-telemetry", "health-check", "log-review", "patterns", "research-import"]);

async function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

const pending = await loadJson(commandsFile, []);
const archived = await loadJson(archiveFile, []);
const done = await loadJson(doneFile, []);

const blocked = [];
const kept = [];
for (const cmd of pending) {
  if (BLOCKED.has(cmd.action)) blocked.push({ ...cmd, archivedAt: new Date().toISOString() });
  else if (SAFE.has(cmd.action)) kept.push(cmd);
  else blocked.push({ ...cmd, archivedAt: new Date().toISOString(), reason: "unknown_action" });
}

await mkdir(dirname(commandsFile), { recursive: true });
await writeFile(commandsFile, JSON.stringify(kept, null, 2), "utf8");
await writeFile(archiveFile, JSON.stringify([...archived, ...blocked].slice(-500), null, 2), "utf8");

for (const cmd of blocked) {
  if (!done.some((d) => d.id === cmd.id)) {
    done.push({
      ...cmd,
      completedAt: new Date().toISOString(),
      exit: -1,
      skipped: "phase5-sanitize",
    });
  }
}
await writeFile(doneFile, JSON.stringify(done.slice(-200), null, 2), "utf8");

console.log(`[sanitize] blocked ${blocked.length} destructive commands`);
console.log(`[sanitize] kept ${kept.length} safe commands`);
console.log(`[sanitize] archive: ${archiveFile}`);
