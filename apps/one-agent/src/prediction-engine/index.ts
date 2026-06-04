import { randomUUID } from "node:crypto";
import type { MarketTick, Prediction } from "../types.js";
import { ALL_STRATEGIES } from "./strategies/index.js";
import { ensemblePredict } from "./ensemble.js";
import {
  loadStrategyWeights,
  type StrategyWeights,
} from "../learning/adaptive-weights.js";

const DEFAULT_HORIZON_SEC = 30;
const MAX_PRICES = 120;

export interface PredictionEngineOptions {
  horizonSec?: number;
}

export class PredictionEngine {
  readonly horizonSec: number;
  private prices: number[] = [];
  private weights: StrategyWeights = {};
  private weightsLoaded = false;

  constructor(options: PredictionEngineOptions = {}) {
    this.horizonSec = options.horizonSec ?? DEFAULT_HORIZON_SEC;
  }

  async init(): Promise<void> {
    this.weights = await loadStrategyWeights(
      ALL_STRATEGIES.map((s) => s.id),
    );
    this.weightsLoaded = true;
  }

  predict(tick: MarketTick): Prediction {
    this.prices.push(tick.price);
    if (this.prices.length > MAX_PRICES) this.prices.shift();

    if (!this.weightsLoaded) {
      void this.init();
    }

    const ctx = { prices: [...this.prices], currentPrice: tick.price };
    const votes = ALL_STRATEGIES.map((s) => s.evaluate(ctx));
    const ensemble = ensemblePredict(votes, this.weights);

    return {
      predictionId: `pred-${randomUUID()}`,
      tickId: tick.tickId,
      symbol: tick.symbol,
      direction: ensemble.direction,
      confidence: ensemble.confidence,
      horizonSec: this.horizonSec,
      priceAtPrediction: tick.price,
      timestamp: tick.timestamp,
      meta: {
        engine: "ensemble_v1",
        agreement: ensemble.agreement,
        strategyVotes: ensemble.votes,
        weights: { ...this.weights },
      },
    };
  }

  getLastVotes() {
    return ALL_STRATEGIES.map((s) => s.id);
  }

  async refreshWeights(): Promise<void> {
    await this.init();
  }

  setWeights(weights: StrategyWeights): void {
    this.weights = weights;
    this.weightsLoaded = true;
  }

  getWeights(): StrategyWeights {
    return { ...this.weights };
  }
}
