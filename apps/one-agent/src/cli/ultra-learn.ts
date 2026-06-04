import { AgentCore } from "../agent-core.js";
import { runMegaTrain } from "../learning/batch-trainer.js";
import { runMegaBacktest } from "../backtest/mega-runner.js";
import { ensureDataDirs, readMetrics } from "../storage/index.js";
import { appendResearchLog } from "../learning/adaptive-weights.js";
import { boostTopStrategies } from "../learning/strategy-orchestrator.js";
import { CYCLES } from "../learning/cycle-config.js";
import { exportModelBundle } from "../learning/model-export.js";

async function main(): Promise<void> {
  await ensureDataDirs();
  const bars = CYCLES.ultraBars;
  const liveCycles = CYCLES.ultra;

  console.log(
    `[zambahola] ULTRA LEARN — ${bars} bars + ${liveCycles} live cycles\n`,
  );

  const pre = await runMegaBacktest(Math.min(bars, 1200));
  console.log("Pre backtest:", pre.hitRate, pre.predictions);

  const train = await runMegaTrain(bars);
  console.log("Mega train:", train.trainSteps, train.source);
  await appendResearchLog({ event: "ultra_mega_train", ...train });

  for (let i = 1; i <= liveCycles; i++) {
    const agent = new AgentCore({ resetData: i === 1 });
    await agent.start();
    await new Promise((r) => setTimeout(r, CYCLES.cycleMs));
    await agent.stop();

    const metrics = await readMetrics();
    await boostTopStrategies(metrics?.strategyStats, 8);

    await appendResearchLog({
      event: "ultra_live_cycle",
      cycle: i,
      hitRate: metrics?.hitRate,
      strategyStats: metrics?.strategyStats,
    });
    console.log(
      `Live ${i}/${liveCycles} hit=${metrics?.hitRate} preds=${metrics?.predictionCount}`,
    );
  }

  const post = await runMegaBacktest(Math.min(bars, 1200));
  console.log("\nPost backtest:", JSON.stringify(post, null, 2));
  await appendResearchLog({ event: "ultra_complete", pre, train, post });

  const exported = await exportModelBundle("hybrid_v7");
  console.log("\nModel export:", exported.path, exported.files);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
