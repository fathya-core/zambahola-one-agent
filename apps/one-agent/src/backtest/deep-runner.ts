import { PredictionEngine } from "../prediction-engine/index.js";
import { Evaluator } from "../evaluator/index.js";
import { loadOrFetchKlines } from "../data/klines-cache.js";
import type { MarketTick } from "../types.js";
import { refreshMarketSignals } from "../market-signals/index.js";
import { getAccuracyTuning } from "../config/accuracy-profile.js";

export interface DeepBacktestResult {
  ok: boolean;
  bars: number;
  predictions: number;
  evaluations: number;
  hitRate: number;
  directionalHitRate: number;
  directionalCount: number;
  abstainRate: number;
  source: string;
  walkForwardWindows: number;
}

export async function runDeepBacktest(limit = 500): Promise<DeepBacktestResult> {
  await refreshMarketSignals();
  const { bars, source } = await loadOrFetchKlines(limit);
  const horizonSec = getAccuracyTuning().horizonSec;
  const evalOffsetMs = horizonSec * 1000;

  const engine = new PredictionEngine({ horizonSec });
  await engine.init();
  const evaluator = new Evaluator();

  let predictions = 0;
  const window = 80;
  const walkForwardWindows = Math.floor((bars.length - window) / 40);

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const tick: MarketTick = {
      tickId: `dk-${i}`,
      symbol: "BTCUSDT",
      price: b.close,
      timestamp: b.openTime,
    };
    const pred = engine.predict(tick);
    predictions += 1;
    evaluator.schedule(pred);
  }

  const allHits: boolean[] = [];
  const dirHits: boolean[] = [];
  let rangeCount = 0;

  for (let i = 0; i < bars.length; i++) {
    const completed = evaluator.onPrice(bars[i]!.close, bars[i]!.openTime + evalOffsetMs);
    for (const { evaluation } of completed) {
      allHits.push(evaluation.predictionHit);
      if (evaluation.direction === "range") {
        rangeCount += 1;
      } else {
        dirHits.push(evaluation.predictionHit);
      }
    }
  }

  const hitRate =
    allHits.length > 0 ? allHits.filter(Boolean).length / allHits.length : 0;
  const directionalHitRate =
    dirHits.length > 0 ? dirHits.filter(Boolean).length / dirHits.length : 0;
  const abstainRate =
    allHits.length > 0 ? Number((rangeCount / allHits.length).toFixed(4)) : 0;

  return {
    ok: predictions >= 200,
    bars: bars.length,
    predictions,
    evaluations: allHits.length,
    hitRate: Number(hitRate.toFixed(4)),
    directionalHitRate: Number(directionalHitRate.toFixed(4)),
    directionalCount: dirHits.length,
    abstainRate,
    source,
    walkForwardWindows,
  };
}
