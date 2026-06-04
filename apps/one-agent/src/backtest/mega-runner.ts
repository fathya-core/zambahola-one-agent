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
  /** up/down only — excludes range abstains */
  directionalHitRate: number;
  directionalCount: number;
  abstainRate: number;
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

  const allHits: boolean[] = [];
  const dirHits: boolean[] = [];
  let rangeCount = 0;

  for (let i = 0; i < bars.length; i++) {
    const completed = evaluator.onPrice(bars[i]!.close, bars[i]!.openTime + 60_000);
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
    ok: predictions >= Math.max(200, Math.floor(bars.length * 0.7)),
    bars: bars.length,
    predictions,
    evaluations: allHits.length,
    hitRate: Number(hitRate.toFixed(4)),
    directionalHitRate: Number(directionalHitRate.toFixed(4)),
    directionalCount: dirHits.length,
    abstainRate,
    source,
  };
}
