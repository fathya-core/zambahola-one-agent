import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const COMMANDS_FILE = join(pkgRoot, "data", "bridge", "REMOTE-COMMANDS.json");

export interface QueuedCommand {
  id: string;
  ts: string;
  action: string;
  payload: Record<string, unknown>;
  source: string;
}

export async function queueRemoteAction(
  action: string,
  payload: Record<string, unknown> = {},
  source = "analyst",
): Promise<QueuedCommand> {
  const cmd: QueuedCommand = {
    id: `cmd-analyst-${Date.now()}`,
    ts: new Date().toISOString(),
    action,
    payload,
    source,
  };
  await mkdir(dirname(COMMANDS_FILE), { recursive: true });
  let existing: QueuedCommand[] = [];
  if (existsSync(COMMANDS_FILE)) {
    try {
      existing = JSON.parse(await readFile(COMMANDS_FILE, "utf8")) as QueuedCommand[];
    } catch {
      existing = [];
    }
  }
  existing.push(cmd);
  await writeFile(COMMANDS_FILE, JSON.stringify(existing.slice(-50), null, 2), "utf8");
  return cmd;
}
