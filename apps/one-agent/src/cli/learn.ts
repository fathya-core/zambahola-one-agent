import { AgentCore } from "../agent-core.js";
import { ensureDataDirs } from "../storage/index.js";
import { readMetrics } from "../storage/index.js";
import { appendResearchLog } from "../learning/adaptive-weights.js";

const CYCLES = 3;
const CYCLE_MS = 65_000;

async function main(): Promise<void> {
  await ensureDataDirs();
  console.log(`[zambahola] learn: ${CYCLES} cycles × ${CYCLE_MS / 1000}s\n`);

  for (let i = 1; i <= CYCLES; i++) {
    const agent = new AgentCore({ resetData: i === 1 });
    await agent.start();
    await new Promise((r) => setTimeout(r, CYCLE_MS));
    await agent.stop();

    const metrics = await readMetrics();
    await appendResearchLog({
      event: "learn_cycle",
      cycle: i,
      hitRate: metrics?.hitRate,
      predictionCount: metrics?.predictionCount,
      strategyStats: metrics?.strategyStats,
    });

    console.log(
      `Cycle ${i}/${CYCLES} — predictions: ${metrics?.predictionCount} hitRate: ${metrics?.hitRate}`,
    );
  }

  const final = await readMetrics();
  console.log("\n[zambahola] learn complete:", JSON.stringify(final?.strategyStats, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
