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
  process.env.ZAMBAHOLA_ULTRA_LIGHT ??= "1";
  await ensureDataDirs();
  const bars = CYCLES.ultraBars;
  const liveCycles = CYCLES.ultra;
  const skipMega = process.env.ZAMBAHOLA_ULTRA_SKIP_MEGA === "1";

  console.log(
    `[zambahola] ULTRA LEARN — ${bars} bars + ${liveCycles} live cycles` +
      `${skipMega ? " (skip mega)" : ""}\n`,
  );

  if (!skipMega) {
    const train = await runMegaTrain(bars);
    console.log("Mega train:", train.trainSteps, train.source);
    await appendResearchLog({ event: "ultra_mega_train", ...train });
  } else {
    console.log("Mega train: skipped (omni-train already ran mega-train)");
  }

  const agent = new AgentCore({ resetData: true });
  let completed = 0;

  for (let i = 1; i <= liveCycles; i++) {
    try {
      if (agent.isRunning()) await agent.stop();
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
        predictionCount: metrics?.predictionCount,
        strategyCount: metrics?.strategyStats?.length ?? 0,
      });
      console.log(
        `Live ${i}/${liveCycles} hit=${metrics?.hitRate} dir=${metrics?.directionalHitRate} preds=${metrics?.predictionCount}`,
      );
      completed = i;
    } catch (err) {
      console.error(`[ultra-learn] cycle ${i}/${liveCycles} failed:`, err);
      try {
        if (agent.isRunning()) await agent.stop();
      } catch {
        /* */
      }
      if (completed === 0 && i <= 2) {
        throw err;
      }
      console.warn(`[ultra-learn] continuing after cycle ${i} failure`);
      break;
    }
  }

  if (completed === 0) {
    console.error("[ultra-learn] no live cycles completed");
    process.exit(1);
  }

  const exported = await exportModelBundle("hybrid_v7");
  console.log("\nModel export:", exported.path, exported.files);
  console.log(
    `\n[zambahola] Ultra done (${completed}/${liveCycles} cycles) — راقب directional hit على اللوحة الحية.\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
