import { runMegaTrain } from "./batch-trainer.js";
import { appendResearchLog } from "./adaptive-weights.js";

export interface WalkForwardResult {
  windows: number;
  totalBars: number;
  trainSteps: number;
  lastSource: string;
}

/** Multi-window walk-forward: train on rolling slices (live metrics only — no backtest) */
export async function runWalkForwardTrain(
  totalBars = 8000,
  windows = 4,
): Promise<WalkForwardResult> {
  const slice = Math.floor(totalBars / windows);
  let trainSteps = 0;
  let lastSource = "unknown";

  for (let w = 0; w < windows; w++) {
    const bars = slice + w * Math.floor(slice * 0.15);
    const train = await runMegaTrain(Math.min(totalBars, bars));
    trainSteps += train.trainSteps;
    lastSource = train.source;

    await appendResearchLog({
      event: "walk_forward_window",
      window: w + 1,
      bars,
      trainSteps: train.trainSteps,
      source: train.source,
    });

    console.log(
      `[walk-forward] window ${w + 1}/${windows} trainSteps=${train.trainSteps} source=${train.source}`,
    );
  }

  return {
    windows,
    totalBars,
    trainSteps,
    lastSource,
  };
}
