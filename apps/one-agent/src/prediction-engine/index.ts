import { randomUUID } from "node:crypto";
import type { MarketTick, Prediction, PredictionDirection } from "../types.js";
import { ALL_STRATEGIES } from "./strategies/index.js";
import { ensemblePredict } from "./ensemble.js";
import { loadStrategyWeights, type StrategyWeights } from "../learning/adaptive-weights.js";
import { extractFeatures } from "../features/index.js";
import { OnlineMLModel } from "./ml-model.js";
import { MLPModel } from "./mlp-model.js";
import { applyRegimeGate, detectRegime } from "./regime-gate.js";
import { ConfidenceCalibrator } from "../learning/calibration.js";
import { getSentiment } from "../sentiment/index.js";

const DEFAULT_HORIZON_SEC = 30;
const MAX_PRICES = 300;

export interface PredictionEngineOptions {
  horizonSec?: number;
}

export class PredictionEngine {
  readonly horizonSec: number;
  readonly ml = new OnlineMLModel();
  readonly mlp = new MLPModel();
  readonly calibrator = new ConfidenceCalibrator();

  private prices: number[] = [];
  private volumes: number[] = [];
  private weights: StrategyWeights = {};
  private ready = false;

  constructor(options: PredictionEngineOptions = {}) {
    this.horizonSec = options.horizonSec ?? DEFAULT_HORIZON_SEC;
  }

  async init(): Promise<void> {
    this.weights = await loadStrategyWeights(ALL_STRATEGIES.map((s) => s.id));
    await this.ml.load();
    await this.mlp.load();
    await this.calibrator.load();
    this.ready = true;
  }

  predict(tick: MarketTick): Prediction {
    const prev = this.prices[this.prices.length - 1];
    const volProxy = prev
      ? Math.abs(tick.price - prev) * 10 + 1
      : 1;

    this.prices.push(tick.price);
    this.volumes.push(volProxy);
    if (this.prices.length > MAX_PRICES) {
      this.prices.shift();
      this.volumes.shift();
    }
    if (!this.ready) void this.init();

    const sentiment = getSentiment();
    const ctx = {
      prices: [...this.prices],
      volumes: [...this.volumes],
      currentPrice: tick.price,
    };
    const votes = ALL_STRATEGIES.map((s) => s.evaluate(ctx));
    const ensemble = ensemblePredict(votes, this.weights);

    const features = extractFeatures(
      this.prices,
      this.volumes,
      sentiment.score,
      ensemble.agreement,
      tick.timestamp,
    );

    let direction: PredictionDirection = ensemble.direction;
    let confidence = ensemble.confidence;
    let mlScore = 0;
    let mlProb = 0.5;
    let mlpScore = 0;
    let mlpProb = 0.5;
    let regime = "range" as ReturnType<typeof detectRegime>;
    let gateReason = "n/a";

    if (features) {
      const logit = this.ml.predict(features);
      const deep = this.mlp.predict(features);
      mlScore = logit.score;
      mlProb = logit.prob;
      mlpScore = deep.score;
      mlpProb = deep.prob;
      regime = detectRegime(features);

      const blended = blendTriple(
        ensemble.direction,
        ensemble.confidence,
        logit.direction,
        logit.prob,
        deep.direction,
        deep.prob,
      );
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
        engine: "hybrid_v4_deep",
        agreement: ensemble.agreement,
        strategyVotes: ensemble.votes,
        weights: { ...this.weights },
        regime,
        gateReason,
        mlScore,
        mlProb,
        mlpScore,
        mlpProb,
        mlSamples: this.ml.getSampleCount(),
        mlpSamples: this.mlp.getSampleCount(),
        sentiment: sentiment.score,
        sentimentLabel: sentiment.label,
        features: features ? { ...features } : undefined,
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
      await this.mlp.train(features as import("../features/index.js").FeatureVector, label);
    }
    this.calibrator.record(rawConfidence, hit);
    await this.calibrator.save();
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

function blendTriple(
  eDir: PredictionDirection,
  eConf: number,
  lDir: PredictionDirection,
  lProb: number,
  mDir: PredictionDirection,
  mProb: number,
): { direction: PredictionDirection; confidence: number } {
  const s = (d: PredictionDirection, w: number) =>
    d === "up" ? w : d === "down" ? -w : 0;

  const combined =
    s(eDir, eConf) * 0.4 +
    s(lDir, (lProb - 0.5) * 2) * 0.3 +
    s(mDir, (mProb - 0.5) * 2) * 0.3;

  let direction: PredictionDirection = "range";
  if (combined > 0.1) direction = "up";
  else if (combined < -0.1) direction = "down";

  const dirs = [eDir, lDir, mDir].filter((d) => d === direction && d !== "range").length;
  let confidence = Math.min(0.96, Math.abs(combined) * 0.9 + 0.4);
  if (dirs >= 2) confidence = Math.min(0.96, confidence + 0.1);

  return { direction, confidence: Number(confidence.toFixed(4)) };
}
