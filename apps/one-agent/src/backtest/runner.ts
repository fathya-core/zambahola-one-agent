import { PredictionEngine } from "../prediction-engine/index.js";
import { Evaluator } from "../evaluator/index.js";
import type { MarketTick } from "../types.js";

const KLINE_URL =
  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=120";

export interface BacktestResult {
  ok: boolean;
  candles: number;
  predictions: number;
  hitRate: number;
  source: string;
}

function syntheticPrices(n: number): number[] {
  const out: number[] = [];
  let p = 97000;
  for (let i = 0; i < n; i++) {
    p += (Math.random() - 0.5) * 80;
    out.push(Number(p.toFixed(2)));
  }
  return out;
}

export async function runBacktest(): Promise<BacktestResult> {
  let prices: number[] = [];
  let source = "synthetic";

  try {
    const res = await fetch(KLINE_URL, { signal: AbortSignal.timeout(12000) });
    const data = (await res.json()) as number[][];
    prices = data.map((c) => Number(c[4]));
    source = "binance_1m";
  } catch {
    prices = syntheticPrices(120);
  }

  const engine = new PredictionEngine({ horizonSec: 30 });
  await engine.init();
  const evaluator = new Evaluator();

  let predictions = 0;
  const evaluations: boolean[] = [];

  for (let i = 0; i < prices.length; i++) {
    const tick: MarketTick = {
      tickId: `bt-${i}`,
      symbol: "BTCUSDT",
      price: prices[i]!,
      timestamp: Date.now() + i * 60_000,
    };
    const pred = engine.predict(tick);
    predictions += 1;
    evaluator.schedule(pred);
  }

  for (let i = 0; i < prices.length; i++) {
    const ts = Date.now() + (i + 1) * 60_000;
    const completed = evaluator.onPrice(prices[i]!, ts);
    for (const { evaluation } of completed) {
      evaluations.push(evaluation.predictionHit);
    }
  }

  const hits = evaluations.filter(Boolean).length;
  const hitRate = evaluations.length > 0 ? hits / evaluations.length : 0;

  return {
    ok: predictions >= 60,
    candles: prices.length,
    predictions,
    hitRate: Number(hitRate.toFixed(4)),
    source,
  };
}
