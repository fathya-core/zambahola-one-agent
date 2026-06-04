import { randomUUID } from "node:crypto";
import type { MarketTick, Prediction, PredictionDirection } from "../types.js";

const DEFAULT_HORIZON_SEC = 30;
const LOOKBACK = 5;
const MOMENTUM_THRESHOLD = 25;

export interface PredictionEngineOptions {
  horizonSec?: number;
}

export class PredictionEngine {
  readonly horizonSec: number;
  private prices: number[] = [];

  constructor(options: PredictionEngineOptions = {}) {
    this.horizonSec = options.horizonSec ?? DEFAULT_HORIZON_SEC;
  }

  predict(tick: MarketTick): Prediction {
    this.prices.push(tick.price);
    if (this.prices.length > LOOKBACK + 1) {
      this.prices.shift();
    }

    let direction: PredictionDirection = "range";
    let confidence = 0.45;

    if (this.prices.length >= LOOKBACK) {
      const oldest = this.prices[0]!;
      const momentum = tick.price - oldest;
      if (momentum > MOMENTUM_THRESHOLD) {
        direction = "up";
        confidence = Math.min(0.95, 0.55 + momentum / 500);
      } else if (momentum < -MOMENTUM_THRESHOLD) {
        direction = "down";
        confidence = Math.min(0.95, 0.55 + Math.abs(momentum) / 500);
      } else {
        direction = "range";
        confidence = 0.5 + Math.min(0.35, (MOMENTUM_THRESHOLD - Math.abs(momentum)) / 100);
      }
    }

    return {
      predictionId: `pred-${randomUUID()}`,
      tickId: tick.tickId,
      symbol: tick.symbol,
      direction,
      confidence: Number(confidence.toFixed(4)),
      horizonSec: this.horizonSec,
      priceAtPrediction: tick.price,
      timestamp: tick.timestamp,
    };
  }
}
