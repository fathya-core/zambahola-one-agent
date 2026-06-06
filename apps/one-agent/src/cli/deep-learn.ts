import { AgentCore } from "../agent-core.js";
import { ensureDataDirs } from "../storage/index.js";
import { appendResearchLog } from "../learning/adaptive-weights.js";

import { CYCLES } from "../learning/cycle-config.js";
const CYCLE_MS = 65_000;

async function main(): Promise<void> {
  process.env.ZAMBAHOLA_FEED ??= "mock";
  await ensureDataDirs();
  const cycles = CYCLES.deep;
  console.log(`[zambahola] DEEP LEARN: ${cycles} live cycles\n`);

  for (let i = 1; i <= cycles; i++) {
    const agent = new AgentCore({ resetData: i === 1 });
    await agent.start();
    await new Promise((r) => setTimeout(r, CYCLE_MS));
    await agent.stop();

    const metrics = agent.getRuntimeState().metrics;
    await appendResearchLog({
      event: "deep_learn_cycle",
      cycle: i,
      hitRate: metrics?.hitRate,
      directionalHitRate: metrics?.directionalHitRate,
      mlpSamples: metrics?.lastPrediction?.meta?.mlpSamples,
      mlSamples: metrics?.mlSamples,
    });
    console.log(
      `Cycle ${i}/${cycles} hit=${metrics?.hitRate} dir=${metrics?.directionalHitRate} mlp=${metrics?.lastPrediction?.meta?.mlpSamples}`,
    );
  }

  console.log("\n[zambahola] Deep learn done — راقب اللوحة للإصابة الاتجاهية.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
