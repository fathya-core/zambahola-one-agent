import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import open from "open";
import { AGENT_PID_FILE, DASHBOARD_PORT } from "../storage/paths.js";
import { ensureDataDirs } from "../storage/index.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const runner = join(pkgRoot, "src/cli/runner.ts");

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await ensureDataDirs();

  if (existsSync(AGENT_PID_FILE)) {
    const pid = Number(await readFile(AGENT_PID_FILE, "utf8"));
    if (pid && isProcessAlive(pid)) {
      console.log(`[zambahola] Agent already running (pid ${pid})`);
      console.log(`[zambahola] Dashboard: http://127.0.0.1:${DASHBOARD_PORT}`);
      await open(`http://127.0.0.1:${DASHBOARD_PORT}`);
      return;
    }
  }

  const tsxBin = join(pkgRoot, "node_modules", ".bin", "tsx");
  const child = spawn(tsxBin, [runner], {
    cwd: pkgRoot,
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });

  child.unref();

  await new Promise((r) => setTimeout(r, 1500));

  const url = `http://127.0.0.1:${DASHBOARD_PORT}`;
  console.log(`[zambahola] Agent started — opening ${url}`);
  try {
    await open(url);
  } catch {
    console.log(`[zambahola] Open manually: ${url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
