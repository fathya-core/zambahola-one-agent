import { AgentCore } from "../agent-core.js";
import { runMegaTrain } from "../learning/batch-trainer.js";
import { ensureDataDirs } from "../storage/index.js";
import { appendResearchLog } from "../learning/adaptive-weights.js";
import { boostTopStrategies } from "../learning/strategy-orchestrator.js";
import { CYCLES } from "../learning/cycle-config.js";
import { getAccuracyTuning } from "../config/accuracy-profile.js";
import { exportModelBundle } from "../learning/model-export.js";

async function main(): Promise<void> {
  process.env.ZAMBAHOLA_FEED ??= "mock";
  await ensureDataDirs();
  const bars = CYCLES.ultraBars;
  const liveCycles = CYCLES.ultra;

  console.log(
    `[zambahola] ULTRA LEARN — ${bars} bars + ${liveCycles} live cycles\n`,
  );

  const train = await runMegaTrain(bars);
  console.log("Mega train:", train.trainSteps, train.source);
  await appendResearchLog({ event: "ultra_mega_train", ...train });

  for (let i = 1; i <= liveCycles; i++) {
    const agent = new AgentCore({ resetData: i === 1 });
    await agent.start();
    await new Promise((r) => setTimeout(r, CYCLES.cycleMs));
    await agent.stop();

    const metrics = agent.getRuntimeState().metrics;
    await boostTopStrategies(metrics?.strategyStats, getAccuracyTuning().orchestratorTopN);

    await appendResearchLog({
      event: "ultra_live_cycle",
      cycle: i,
      hitRate: metrics?.hitRate,
      directionalHitRate: metrics?.directionalHitRate,
      strategyStats: metrics?.strategyStats,
    });
    console.log(
      `Live ${i}/${liveCycles} hit=${metrics?.hitRate} dir=${metrics?.directionalHitRate} preds=${metrics?.predictionCount}`,
    );
  }

  const exported = await exportModelBundle("hybrid_v7");
  console.log("\nModel export:", exported.path, exported.files);
  console.log("\n[zambahola] Ultra done — راقب directional hit على اللوحة الحية.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
