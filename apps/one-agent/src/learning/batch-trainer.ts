import { loadOrFetchKlines } from "../data/klines-cache.js";
import { PredictionEngine } from "../prediction-engine/index.js";
import type { MarketTick } from "../types.js";
import { refreshMarketSignals } from "../market-signals/index.js";

export interface MegaTrainResult {
  bars: number;
  trainSteps: number;
  source: string;
  mlSamples: number;
  mlpSamples: number;
  gbmSamples: number;
}

export async function runMegaTrain(bars = 1200): Promise<MegaTrainResult> {
  await refreshMarketSignals();
  const { bars: klines, source } = await loadOrFetchKlines(bars);
  const engine = new PredictionEngine({ horizonSec: 60 });
  await engine.init();

  let trainSteps = 0;

  for (let i = 30; i < klines.length - 2; i++) {
    const slice = klines.slice(0, i + 1);
    engine.seedHistory(
      slice.map((b) => b.close),
      slice.map((b) => b.volume),
    );

    const tick: MarketTick = {
      tickId: `mt-${i}`,
      symbol: "BTCUSDT",
      price: klines[i]!.close,
      timestamp: klines[i]!.openTime,
    };
    const pred = engine.predict(tick);
    const future = klines[i + 1]!.close;
    const change = future - tick.price;
    const band = tick.price * 0.0008;
    const hit =
      pred.direction === "up"
        ? change > band
        : pred.direction === "down"
          ? change < -band
          : Math.abs(change) <= band;

    if (pred.meta?.features) {
      await engine.onEvaluationHit(
        pred.meta.features,
        pred.direction,
        hit,
        pred.confidence,
      );
      trainSteps += 1;
    }
  }

  return {
    bars: klines.length,
    trainSteps,
    source,
    mlSamples: engine.ml.getSampleCount(),
    mlpSamples: engine.mlp.getSampleCount(),
    gbmSamples: engine.gbm.getSampleCount(),
  };
}
