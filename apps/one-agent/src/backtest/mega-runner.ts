import { PredictionEngine } from "../prediction-engine/index.js";
import { Evaluator } from "../evaluator/index.js";
import { loadOrFetchKlines } from "../data/klines-cache.js";
import type { MarketTick } from "../types.js";
import { refreshMarketSignals } from "../market-signals/index.js";

export interface MegaBacktestResult {
  ok: boolean;
  bars: number;
  predictions: number;
  evaluations: number;
  hitRate: number;
  source: string;
}

export async function runMegaBacktest(limit = 1200): Promise<MegaBacktestResult> {
  await refreshMarketSignals();
  const { bars, source } = await loadOrFetchKlines(limit);
  const engine = new PredictionEngine({ horizonSec: 60 });
  await engine.init();
  const evaluator = new Evaluator();

  let predictions = 0;

  for (let i = 0; i < bars.length; i++) {
    const slice = bars.slice(0, i + 1);
    if (slice.length < 30) continue;
    engine.seedHistory(
      slice.map((b) => b.close),
      slice.map((b) => b.volume),
    );
    const b = bars[i]!;
    const tick: MarketTick = {
      tickId: `mb-${i}`,
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

  const hitRate =
    evaluations.length > 0
      ? evaluations.filter(Boolean).length / evaluations.length
      : 0;

  return {
    ok: predictions >= Math.max(200, Math.floor(bars.length * 0.7)),
    bars: bars.length,
    predictions,
    evaluations: evaluations.length,
    hitRate: Number(hitRate.toFixed(4)),
    source,
  };
}
