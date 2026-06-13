import { AgentCore } from "../agent-core.js";
import { readMetrics } from "../storage/index.js";
import { LATEST_RUN_FILE } from "../storage/paths.js";
import { readFile } from "node:fs/promises";

const MIN_PREDICTIONS = 60;
const RUN_MS = 65_000;

async function main(): Promise<void> {
  process.env.ZAMBAHOLA_RESET = "1";
  process.env.ZAMBAHOLA_FEED = process.env.ZAMBAHOLA_FEED ?? "mock";
  const agent = new AgentCore({ resetData: true });

  console.log(`[zambahola] test-run: ${RUN_MS / 1000}s headless run…`);
  await agent.start();

  await new Promise((r) => setTimeout(r, RUN_MS));

  await agent.stop();

  const metrics = await readMetrics();
  const predictionCount = metrics?.predictionCount ?? 0;

  let runLines = 0;
  try {
    const raw = await readFile(LATEST_RUN_FILE, "utf8");
    runLines = raw.trim().split("\n").filter(Boolean).length;
  } catch {
    runLines = 0;
  }

  console.log(
    JSON.stringify(
      {
        ok: predictionCount >= MIN_PREDICTIONS,
        predictionCount,
        minRequired: MIN_PREDICTIONS,
        runLines,
        hitRate: metrics?.hitRate,
        paperPnl: metrics?.paperPnl,
      },
      null,
      2,
    ),
  );

  if (predictionCount < MIN_PREDICTIONS) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
