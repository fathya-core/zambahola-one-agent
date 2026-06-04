import { PredictionEngine } from "../prediction-engine/index.js";
import { Evaluator } from "../evaluator/index.js";
import { loadOrFetchKlines } from "../data/klines-cache.js";
import type { MarketTick } from "../types.js";
import { refreshMarketSignals } from "../market-signals/index.js";

export interface DeepBacktestResult {
  ok: boolean;
  bars: number;
  predictions: number;
  evaluations: number;
  hitRate: number;
  source: string;
  walkForwardWindows: number;
}

export async function runDeepBacktest(limit = 500): Promise<DeepBacktestResult> {
  await refreshMarketSignals();
  const { bars, source } = await loadOrFetchKlines(limit);

  const engine = new PredictionEngine({ horizonSec: 30 });
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

  const evaluations: boolean[] = [];
  for (let i = 0; i < bars.length; i++) {
    const completed = evaluator.onPrice(bars[i]!.close, bars[i]!.openTime + 60_000);
    for (const { evaluation } of completed) {
      evaluations.push(evaluation.predictionHit);
    }
  }

  const hits = evaluations.filter(Boolean).length;
  const hitRate = evaluations.length > 0 ? hits / evaluations.length : 0;

  return {
    ok: predictions >= 200,
    bars: bars.length,
    predictions,
    evaluations: evaluations.length,
    hitRate: Number(hitRate.toFixed(4)),
    source,
    walkForwardWindows,
  };
}
