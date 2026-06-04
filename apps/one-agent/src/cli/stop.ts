import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { AGENT_PID_FILE, AGENT_STATUS_FILE } from "../storage/paths.js";

async function main(): Promise<void> {
  if (!existsSync(AGENT_PID_FILE)) {
    console.log("[zambahola] Agent is not running (no pid file)");
    process.exit(0);
  }

  const pid = Number(await readFile(AGENT_PID_FILE, "utf8"));
  if (!pid) {
    console.log("[zambahola] Invalid pid file");
    process.exit(1);
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`[zambahola] Stopped agent (pid ${pid})`);
  } catch {
    console.log("[zambahola] Process not found — cleaning pid file");
  }

  if (existsSync(AGENT_PID_FILE)) await unlink(AGENT_PID_FILE);
  if (existsSync(AGENT_STATUS_FILE)) await unlink(AGENT_STATUS_FILE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
