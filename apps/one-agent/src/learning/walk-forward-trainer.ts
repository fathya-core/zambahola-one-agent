import { runMegaTrain } from "./batch-trainer.js";
import { runMegaBacktest } from "../backtest/mega-runner.js";
import { appendResearchLog } from "./adaptive-weights.js";

export interface WalkForwardResult {
  windows: number;
  totalBars: number;
  trainSteps: number;
  avgHitRate: number;
  avgDirectionalHitRate: number;
  lastSource: string;
}

/** Multi-window walk-forward: train on rolling slices, validate each window */
export async function runWalkForwardTrain(
  totalBars = 8000,
  windows = 4,
): Promise<WalkForwardResult> {
  const slice = Math.floor(totalBars / windows);
  let trainSteps = 0;
  let hitSum = 0;
  let dirSum = 0;
  let lastSource = "unknown";

  for (let w = 0; w < windows; w++) {
    const bars = slice + w * Math.floor(slice * 0.15);
    const train = await runMegaTrain(Math.min(totalBars, bars));
    trainSteps += train.trainSteps;
    lastSource = train.source;

    const bt = await runMegaBacktest(Math.min(1200, Math.floor(bars * 0.4)));
    hitSum += bt.hitRate;
    dirSum += bt.directionalHitRate;

    await appendResearchLog({
      event: "walk_forward_window",
      window: w + 1,
      bars,
      hitRate: bt.hitRate,
      directionalHitRate: bt.directionalHitRate,
      trainSteps: train.trainSteps,
    });

    console.log(
      `[walk-forward] window ${w + 1}/${windows} hit=${bt.hitRate} dir=${bt.directionalHitRate}`,
    );
  }

  return {
    windows,
    totalBars,
    trainSteps,
    avgHitRate: Number((hitSum / windows).toFixed(4)),
    avgDirectionalHitRate: Number((dirSum / windows).toFixed(4)),
    lastSource,
  };
}
