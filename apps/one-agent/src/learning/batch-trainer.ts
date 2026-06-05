import { loadOrFetchKlines } from "../data/klines-cache.js";
import { PredictionEngine } from "../prediction-engine/index.js";
import type { MarketTick } from "../types.js";
import { refreshMarketSignals } from "../market-signals/index.js";
import { getAccuracyTuning } from "../config/accuracy-profile.js";
import {
  computeHitBand,
  horizonBarsAhead,
  isPredictionHit,
} from "./hit-eval.js";

export interface MegaTrainResult {
  bars: number;
  trainSteps: number;
  source: string;
  mlSamples: number;
  mlpSamples: number;
  gbmSamples: number;
  strategiesFocus?: string[];
}

function parseStrategiesFocus(): string[] | null {
  const phase = process.env.ZAMBAHOLA_CURRICULUM_PHASE;
  if (!phase) return null;
  const raw = process.env.ZAMBAHOLA_STRATEGIES_FOCUS;
  if (!raw || raw === "*") return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function runMegaTrain(bars = 3000): Promise<MegaTrainResult> {
  await refreshMarketSignals();
  const { bars: klines, source } = await loadOrFetchKlines(bars);
  const tuning = getAccuracyTuning();
  const horizonSec = tuning.horizonSec;
  const ahead = horizonBarsAhead(horizonSec);
  const focus = parseStrategiesFocus();

  const engine = new PredictionEngine({ horizonSec });
  await engine.init();

  let trainSteps = 0;

  for (let i = 30; i < klines.length - ahead; i++) {
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

    if (focus && pred.meta?.strategyVotes) {
      const voted = pred.meta.strategyVotes.some((v) => focus.includes(v.strategyId));
      if (!voted && pred.direction !== "range") continue;
    }

    const future = klines[i + ahead]!.close;
    const change = future - tick.price;
    const vol = pred.meta?.features?.volatility ?? 0.0003;
    const band = computeHitBand(tick.price, vol);
    const hit = isPredictionHit(pred.direction, change, band);

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
    strategiesFocus: focus ?? undefined,
  };
}
