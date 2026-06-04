import { writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createZambaholaAgent } from "../sdk/index.js";
import {
  AGENT_PID_FILE,
  AGENT_STATUS_FILE,
  DASHBOARD_PORT,
} from "../storage/paths.js";
import { ensureDataDirs } from "../storage/index.js";

async function main(): Promise<void> {
  const resetData = process.env.ZAMBAHOLA_RESET === "1";
  await ensureDataDirs();

  const agent = createZambaholaAgent({ resetData });
  await agent.start();

  await writeFile(AGENT_PID_FILE, String(process.pid), "utf8");

  const writeStatus = () => {
    const status = agent.getStatus();
    return writeFile(AGENT_STATUS_FILE, JSON.stringify(status, null, 2), "utf8");
  };
  await writeStatus();
  const statusInterval = setInterval(() => {
    void writeStatus();
  }, 2000);

  const shutdown = async () => {
    clearInterval(statusInterval);
    await agent.stop();
    if (existsSync(AGENT_PID_FILE)) await unlink(AGENT_PID_FILE);
    if (existsSync(AGENT_STATUS_FILE)) await unlink(AGENT_STATUS_FILE);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  console.log(
    `[zambahola] ONE AGENT v0 running — dashboard http://127.0.0.1:${DASHBOARD_PORT}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
