import { spawnSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadExpertCurriculum } from "../knowledge/expert-loader.js";
import { applyExpertPresetToDisk } from "../knowledge/expert-loader.js";
import { runMegaTrain } from "./batch-trainer.js";
import { runMegaBacktest } from "../backtest/mega-runner.js";
import { writeJsonAtomic } from "../storage/json-io.js";
import { exportModelBundle } from "./model-export.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PROGRESS = join(pkgRoot, "data", "learning", "curriculum-progress.json");

function runLearnCycles(cycles: number, phaseId: string): boolean {
  const isWin = process.platform === "win32";
  const r = spawnSync(
    isWin ? "npm.cmd" : "npm",
    ["run", "learn", "-w", "@zambahola/one-agent"],
    {
      cwd: join(pkgRoot, ".."),
      env: {
        ...process.env,
        ZAMBAHOLA_LEARN_CYCLES: String(cycles),
        ZAMBAHOLA_FEED: "mock",
        ZAMBAHOLA_EXPERT: "1",
        ZAMBAHOLA_ACCURACY_FILTER: "off",
        ZAMBAHOLA_CURRICULUM_PHASE: phaseId,
      },
      stdio: "inherit",
      shell: isWin,
    },
  );
  return r.status === 0;
}

export interface CurriculumPhaseResult {
  id: string;
  nameAr: string;
  trainBars: number;
  trainSource: string;
  backtestHitRate: number;
  directionalHitRate: number;
  minRequired: number;
  passed: boolean;
  liveCycles: number;
}

export async function runCurriculum(): Promise<{
  ok: boolean;
  phases: CurriculumPhaseResult[];
}> {
  await applyExpertPresetToDisk();
  const curriculum = await loadExpertCurriculum();
  if (!curriculum?.phases?.length) {
    throw new Error("expert-curriculum.json missing");
  }

  const results: CurriculumPhaseResult[] = [];

  for (const phase of curriculum.phases) {
    console.log(`\n[curriculum] === ${phase.id}: ${phase.nameAr} ===\n`);

    process.env.ZAMBAHOLA_KLINES = String(phase.trainBars);
    process.env.ZAMBAHOLA_EXPERT = "1";

    const train = await runMegaTrain(phase.trainBars);
    console.log("[curriculum] train:", train.source, train.trainSteps);

    const bt = await runMegaBacktest(Math.min(phase.trainBars, 1500));
    const passed = bt.hitRate >= phase.minHitRate;

    if (phase.liveCycles > 0) {
      runLearnCycles(phase.liveCycles, phase.id);
    }

    const row: CurriculumPhaseResult = {
      id: phase.id,
      nameAr: phase.nameAr,
      trainBars: phase.trainBars,
      trainSource: train.source,
      backtestHitRate: bt.hitRate,
      directionalHitRate: bt.directionalHitRate,
      minRequired: phase.minHitRate,
      passed,
      liveCycles: phase.liveCycles,
    };
    results.push(row);

    await mkdir(dirname(PROGRESS), { recursive: true });
    await writeJsonAtomic(PROGRESS, {
      updatedAt: Date.now(),
      currentPhase: phase.id,
      results,
    });

    console.log(
      `[curriculum] ${phase.id} hit=${bt.hitRate} dir=${bt.directionalHitRate} ${passed ? "PASS" : "RETRY next"}`,
    );
  }

  await exportModelBundle("hybrid_v7_curriculum");
  const ok = results.every((r) => r.passed);

  await writeFile(
    PROGRESS,
    JSON.stringify({ ok, completedAt: Date.now(), phases: results }, null, 2),
    "utf8",
  );

  return { ok, phases: results };
}
