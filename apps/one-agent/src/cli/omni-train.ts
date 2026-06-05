/**
 * Omni / Hyper Learn — full pipeline before Binance demo.
 * curriculum → walk-forward → ultra → export + research imports
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyResearchImportsToDisk } from "../knowledge/research-import-loader.js";
import { applyExpertPresetToDisk } from "../knowledge/expert-loader.js";
import { runWalkForwardTrain } from "../learning/walk-forward-trainer.js";
import { runMegaBacktest } from "../backtest/mega-runner.js";
import { exportModelBundle } from "../learning/model-export.js";
import { appendResearchLog } from "../learning/adaptive-weights.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const root = join(pkgRoot, "../..");

function runNpm(args: string[], env: Record<string, string | undefined>) {
  const isWin = process.platform === "win32";
  const r = spawnSync(isWin ? "npm.cmd" : "npm", args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: isWin,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const base: Record<string, string> = {
  ZAMBAHOLA_ACCURACY_MODE: "max",
  ZAMBAHOLA_ACCURACY_FILTER: "off",
  ZAMBAHOLA_FEED: "mock",
  ZAMBAHOLA_EXPERT: "1",
  ZAMBAHOLA_STABILIZE: "1",
  ZAMBAHOLA_GUARD_METRIC: "directional",
  ZAMBAHOLA_HORIZON_SEC: process.env.ZAMBAHOLA_HORIZON_SEC ?? "45",
};

async function main(): Promise<void> {
  console.log("[zambahola] OMNI / HYPER LEARN — prepare before Binance\n");

  const research = await applyResearchImportsToDisk();
  if (research.applied) {
    console.log(`[omni] research imports applied: ${research.entries} entries`);
  } else {
    console.log("[omni] no research-imports.json — see knowledge/research-imports.example.json");
  }

  await applyExpertPresetToDisk();

  const skipCurriculum = process.env.ZAMBAHOLA_OMNI_SKIP_CURRICULUM === "1";
  if (!skipCurriculum) {
    console.log("\n[omni] === expert curriculum (4 phases) ===\n");
    runNpm(["run", "agent:curriculum"], base);
  }

  const wfWindows = Number(process.env.ZAMBAHOLA_WF_WINDOWS ?? 5);
  const wfBars = Number(process.env.ZAMBAHOLA_OMNI_KLINES ?? 10000);
  console.log(`\n[omni] === walk-forward ${wfWindows} windows × ${wfBars} bars ===\n`);
  const wf = await runWalkForwardTrain(wfBars, wfWindows);
  await appendResearchLog({ event: "omni_walk_forward", ...wf });

  const epochs = Number(process.env.ZAMBAHOLA_OMNI_EPOCHS ?? 2);
  for (let e = 1; e <= epochs; e++) {
    console.log(`\n[omni] === epoch ${e}/${epochs}: mega-train + ultra-learn ===\n`);
    runNpm(["run", "agent:mega-train"], {
      ...base,
      ZAMBAHOLA_KLINES: String(wfBars),
    });
    runNpm(["run", "agent:ultra-learn"], {
      ...base,
      ZAMBAHOLA_ULTRA_CYCLES: process.env.ZAMBAHOLA_ULTRA_CYCLES ?? "15",
      ZAMBAHOLA_ULTRA_KLINES: String(wfBars),
    });
  }

  const final = await runMegaBacktest(Math.min(1500, wfBars));
  console.log("\n[omni] final backtest:", JSON.stringify(final, null, 2));
  await appendResearchLog({ event: "omni_complete", final });

  const exported = await exportModelBundle("hybrid_v7_omni");
  console.log("\n[omni] export:", exported.path);
  console.log(
    "\n[zambahola] Omni done. If directionalHitRate ≥ 0.58 → Binance demo (docs/ar/ربط-بينانس.md)\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
