import { AgentCore } from "../agent-core.js";
import { ensureDataDirs } from "../storage/index.js";
import { readMetrics } from "../storage/index.js";
import { appendResearchLog } from "../learning/adaptive-weights.js";

import { CYCLES } from "../learning/cycle-config.js";

const CYCLE_MS = CYCLES.cycleMs;

async function main(): Promise<void> {
  await ensureDataDirs();
  const cycles = CYCLES.learn;
  const fromCycle = Math.max(1, Number(process.env.ZAMBAHOLA_LEARN_FROM ?? 1));
  console.log(
    `[zambahola] learn: ${cycles} cycles × ${CYCLE_MS / 1000}s` +
      (fromCycle > 1 ? ` (from cycle ${fromCycle})` : "") +
      "\n",
  );

  for (let i = fromCycle; i <= cycles; i++) {
    const agent = new AgentCore({ resetData: i === 1 && fromCycle === 1 });
    await agent.start();
    await new Promise((r) => setTimeout(r, CYCLE_MS));
    await agent.stop();

    const metrics = agent.getRuntimeState().metrics;
    await appendResearchLog({
      event: "learn_cycle",
      cycle: i,
      hitRate: metrics?.hitRate,
      directionalHitRate: metrics?.directionalHitRate,
      predictionCount: metrics?.predictionCount,
      strategyStats: metrics?.strategyStats,
    });

    console.log(
      `Cycle ${i}/${cycles} — predictions: ${metrics?.predictionCount} hit=${metrics?.hitRate} dir=${metrics?.directionalHitRate}`,
    );
  }

  const final = await readMetrics();
  console.log("\n[zambahola] learn complete:", JSON.stringify(final?.strategyStats, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
