/**
 * Internal kline replay for threshold experiments — NOT user-facing backtest.
 */
import { PredictionEngine } from "../prediction-engine/index.js";
import { Evaluator } from "../evaluator/index.js";
import { loadOrFetchKlines } from "../data/klines-cache.js";
import type { MarketTick } from "../types.js";
import { refreshMarketSignals } from "../market-signals/index.js";

export interface ReplayEvalResult {
  bars: number;
  predictions: number;
  evaluations: number;
  hitRate: number;
  directionalHitRate: number;
  directionalCount: number;
  abstainRate: number;
  source: string;
}

export interface ReplayEvalOptions {
  bars?: number;
  horizonSec?: number;
  labelBp?: number;
}

/** Replay cached klines with env overrides (experiments only). */
export async function replayKlineEvaluate(
  opts: ReplayEvalOptions = {},
): Promise<ReplayEvalResult> {
  const prevLabel = process.env.ZAMBAHOLA_LABEL_BP;
  if (opts.labelBp != null) {
    process.env.ZAMBAHOLA_LABEL_BP = String(opts.labelBp);
  }

  try {
    await refreshMarketSignals();
    const limit = opts.bars ?? 600;
    const { bars, source } = await loadOrFetchKlines(limit);
    const horizonSec = opts.horizonSec ?? Number(process.env.ZAMBAHOLA_HORIZON_SEC ?? 45);
    const engine = new PredictionEngine({ horizonSec });
    await engine.init();
    const evaluator = new Evaluator();

    for (let i = 0; i < bars.length; i++) {
      const slice = bars.slice(0, i + 1);
      if (slice.length < 30) continue;
      engine.seedHistory(
        slice.map((b) => b.close),
        slice.map((b) => b.volume),
      );
      const b = bars[i]!;
      const tick: MarketTick = {
        tickId: `replay-${i}`,
        symbol: "BTCUSDT",
        price: b.close,
        timestamp: b.openTime,
      };
      evaluator.schedule(engine.predict(tick));
    }

    const allHits: boolean[] = [];
    const dirHits: boolean[] = [];
    let rangeCount = 0;

    for (let i = 0; i < bars.length; i++) {
      const completed = evaluator.onPrice(
        bars[i]!.close,
        bars[i]!.openTime + horizonSec * 1000,
      );
      for (const { evaluation } of completed) {
        allHits.push(evaluation.predictionHit);
        if (evaluation.direction === "range") rangeCount += 1;
        else dirHits.push(evaluation.predictionHit);
      }
    }

    const hitRate =
      allHits.length > 0 ? allHits.filter(Boolean).length / allHits.length : 0;
    const directionalHitRate =
      dirHits.length > 0 ? dirHits.filter(Boolean).length / dirHits.length : 0;

    return {
      bars: bars.length,
      predictions: bars.length,
      evaluations: allHits.length,
      hitRate: Number(hitRate.toFixed(4)),
      directionalHitRate: Number(directionalHitRate.toFixed(4)),
      directionalCount: dirHits.length,
      abstainRate:
        allHits.length > 0 ? Number((rangeCount / allHits.length).toFixed(4)) : 0,
      source,
    };
  } finally {
    if (prevLabel === undefined) delete process.env.ZAMBAHOLA_LABEL_BP;
    else process.env.ZAMBAHOLA_LABEL_BP = prevLabel;
  }
}
