import { AgentCore } from "../agent-core.js";
import { runDeepBacktest } from "../backtest/deep-runner.js";
import { ensureDataDirs, readMetrics } from "../storage/index.js";
import { appendResearchLog } from "../learning/adaptive-weights.js";

import { CYCLES } from "../learning/cycle-config.js";
const CYCLE_MS = 65_000;

async function main(): Promise<void> {
  await ensureDataDirs();
  const cycles = CYCLES.deep;
  console.log(`[zambahola] DEEP LEARN: ${cycles} live cycles + kline backtest\n`);

  const bt = await runDeepBacktest(500);
  await appendResearchLog({ event: "deep_backtest_preflight", ...bt });
  console.log("Preflight backtest:", bt.hitRate, bt.source);

  for (let i = 1; i <= cycles; i++) {
    const agent = new AgentCore({ resetData: i === 1 });
    await agent.start();
    await new Promise((r) => setTimeout(r, CYCLE_MS));
    await agent.stop();

    const metrics = await readMetrics();
    await appendResearchLog({
      event: "deep_learn_cycle",
      cycle: i,
      hitRate: metrics?.hitRate,
      mlpSamples: metrics?.lastPrediction?.meta?.mlpSamples,
      mlSamples: metrics?.mlSamples,
    });
    console.log(
      `Cycle ${i}/${cycles} hit=${metrics?.hitRate} mlp=${metrics?.lastPrediction?.meta?.mlpSamples}`,
    );
  }

  const finalBt = await runDeepBacktest(500);
  console.log("\nFinal backtest:", JSON.stringify(finalBt, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
