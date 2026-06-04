import { randomUUID } from "node:crypto";
import type { MarketTick, Prediction, PredictionDirection } from "../types.js";
import { ALL_STRATEGIES } from "./strategies/index.js";
import { ensemblePredict } from "./ensemble.js";
import { loadStrategyWeights, type StrategyWeights } from "../learning/adaptive-weights.js";
import { extractFeatures } from "../features/index.js";
import { OnlineMLModel } from "./ml-model.js";
import { applyRegimeGate, detectRegime } from "./regime-gate.js";
import { ConfidenceCalibrator } from "../learning/calibration.js";
import { getSentiment } from "../sentiment/index.js";

const DEFAULT_HORIZON_SEC = 30;
const MAX_PRICES = 200;

export interface PredictionEngineOptions {
  horizonSec?: number;
}

export class PredictionEngine {
  readonly horizonSec: number;
  readonly ml = new OnlineMLModel();
  readonly calibrator = new ConfidenceCalibrator();

  private prices: number[] = [];
  private weights: StrategyWeights = {};
  private ready = false;

  constructor(options: PredictionEngineOptions = {}) {
    this.horizonSec = options.horizonSec ?? DEFAULT_HORIZON_SEC;
  }

  async init(): Promise<void> {
    this.weights = await loadStrategyWeights(ALL_STRATEGIES.map((s) => s.id));
    await this.ml.load();
    await this.calibrator.load();
    this.ready = true;
  }

  predict(tick: MarketTick): Prediction {
    this.prices.push(tick.price);
    if (this.prices.length > MAX_PRICES) this.prices.shift();
    if (!this.ready) void this.init();

    const sentiment = getSentiment();
    const ctx = { prices: [...this.prices], currentPrice: tick.price };
    const votes = ALL_STRATEGIES.map((s) => s.evaluate(ctx));
    const ensemble = ensemblePredict(votes, this.weights);

    const features = extractFeatures(
      this.prices,
      sentiment.score,
      ensemble.agreement,
    );

    let direction: PredictionDirection = ensemble.direction;
    let confidence = ensemble.confidence;
    let mlScore = 0;
    let mlProb = 0.5;
    let regime = "range" as ReturnType<typeof detectRegime>;
    let gateReason = "n/a";

    if (features) {
      const ml = this.ml.predict(features);
      mlScore = ml.score;
      mlProb = ml.prob;
      regime = detectRegime(features);

      const blended = blendSignals(ensemble.direction, ensemble.confidence, ml.direction, ml.prob);
      direction = blended.direction;
      confidence = blended.confidence;

      const gated = applyRegimeGate(
        direction,
        confidence,
        ensemble.agreement,
        regime,
        sentiment.score,
      );
      direction = gated.direction;
      confidence = this.calibrator.calibrate(gated.confidence);
      gateReason = gated.reason;
    }

    return {
      predictionId: `pred-${randomUUID()}`,
      tickId: tick.tickId,
      symbol: tick.symbol,
      direction,
      confidence,
      horizonSec: this.horizonSec,
      priceAtPrediction: tick.price,
      timestamp: tick.timestamp,
      meta: {
        engine: "hybrid_v2",
        agreement: ensemble.agreement,
        strategyVotes: ensemble.votes,
        weights: { ...this.weights },
        regime,
        gateReason,
        mlScore,
        mlProb,
        mlSamples: this.ml.getSampleCount(),
        sentiment: sentiment.score,
        sentimentLabel: sentiment.label,
        features: features
          ? {
              ret1: features.ret1,
              ret5: features.ret5,
              ret10: features.ret10,
              volatility: features.volatility,
              rsiNorm: features.rsiNorm,
              momentumNorm: features.momentumNorm,
              zScore: features.zScore,
              sentiment: features.sentiment,
              agreement: features.agreement,
            }
          : undefined,
      },
    };
  }

  async onEvaluationHit(
    features: NonNullable<Prediction["meta"]>["features"],
    direction: PredictionDirection,
    hit: boolean,
    rawConfidence: number,
  ): Promise<void> {
    if (features) {
      const label =
        direction === "up" ? (hit ? 1 : 0) : direction === "down" ? (hit ? 0 : 1) : 0.5;
      await this.ml.train(features, label);
    }
    this.calibrator.record(rawConfidence, hit);
    if (this.calibrator.getCalibrationScore() > 0) {
      await this.calibrator.save();
    }
  }

  setWeights(weights: StrategyWeights): void {
    this.weights = weights;
  }

  getWeights(): StrategyWeights {
    return { ...this.weights };
  }

  async refreshWeights(): Promise<void> {
    await this.init();
  }
}

function blendSignals(
  eDir: PredictionDirection,
  eConf: number,
  mDir: PredictionDirection,
  mProb: number,
): { direction: PredictionDirection; confidence: number } {
  const score = (d: PredictionDirection, w: number) =>
    d === "up" ? w : d === "down" ? -w : 0;

  const eScore = score(eDir, eConf);
  const mScore = score(mDir, (mProb - 0.5) * 2);
  const combined = eScore * 0.55 + mScore * 0.45;

  let direction: PredictionDirection = "range";
  if (combined > 0.1) direction = "up";
  else if (combined < -0.1) direction = "down";

  const agree = eDir === mDir || eDir === "range" || mDir === "range";
  let confidence = Math.min(0.94, Math.abs(combined) * 0.85 + 0.42);
  if (agree && eDir === mDir && eDir !== "range") confidence = Math.min(0.94, confidence + 0.12);

  return { direction, confidence: Number(confidence.toFixed(4)) };
}
