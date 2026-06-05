import { AgentCore } from "../agent-core.js";
import { ensureDataDirs } from "../storage/index.js";
import { appendResearchLog } from "../learning/adaptive-weights.js";
import { exportModelBundle } from "../learning/model-export.js";
import { CYCLES } from "../learning/cycle-config.js";

const CYCLE_MS = CYCLES.cycleMs;

async function main(): Promise<void> {
  process.env.ZAMBAHOLA_FEED ??= process.env.ZAMBAHOLA_TEACH_FEED ?? "mock";
  await ensureDataDirs();

  const extra = Number(process.env.ZAMBAHOLA_TEACH_CYCLES ?? 10);
  const reset = process.env.ZAMBAHOLA_TEACH_RESET === "1";

  console.log(
    `[zambahola] TEACH MORE — ${extra} extra cycles (feed=${process.env.ZAMBAHOLA_FEED})\n`,
  );
  console.log("[zambahola] Keeps existing weights; updates after each cycle.\n");

  for (let i = 1; i <= extra; i++) {
    const agent = new AgentCore({ resetData: reset && i === 1 });
    await agent.start();
    await new Promise((r) => setTimeout(r, CYCLE_MS));
    await agent.stop();

    const metrics = agent.getRuntimeState().metrics;
    await appendResearchLog({
      event: "teach_more_cycle",
      cycle: i,
      hitRate: metrics.hitRate,
      mlSamples: metrics.mlSamples,
      understanding: metrics.understandingScore,
    });

    console.log(
      `Teach ${i}/${extra} — hit=${metrics.hitRate} ml=${metrics.mlSamples} understand=${metrics.understandingScore ?? "—"}`,
    );
  }

  const exported = await exportModelBundle("hybrid_v7_teach");
  console.log("\n[zambahola] teach-more done. Export:", exported.path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
