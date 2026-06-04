import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { AGENT_PID_FILE, AGENT_STATUS_FILE, DASHBOARD_PORT } from "../storage/paths.js";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let pid: number | null = null;
  if (existsSync(AGENT_PID_FILE)) {
    pid = Number(await readFile(AGENT_PID_FILE, "utf8"));
  }

  const running = pid != null && isProcessAlive(pid);

  if (existsSync(AGENT_STATUS_FILE)) {
    const status = JSON.parse(await readFile(AGENT_STATUS_FILE, "utf8"));
    console.log(JSON.stringify({ ...status, running, pid }, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        running,
        pid,
        port: DASHBOARD_PORT,
        dashboard: `http://127.0.0.1:${DASHBOARD_PORT}`,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
