import { randomUUID } from "node:crypto";
import type { MarketTick, Prediction, PredictionDirection } from "../types.js";
import { ALL_STRATEGIES, STRATEGY_COUNT } from "./strategies/index.js";
import { loadOrchestratorWeights } from "../learning/strategy-orchestrator.js";
import { ensemblePredict } from "./ensemble.js";
import { loadStrategyWeights, type StrategyWeights } from "../learning/adaptive-weights.js";
import { extractFeatures, type FeatureVector } from "../features/index.js";
import { OnlineMLModel } from "./ml-model.js";
import { MLPModel } from "./mlp-model.js";
import { GBMModel } from "./gbm-model.js";
import { lobCnnPredict } from "./lob-cnn.js";
import { applyRegimeGate, detectRegime } from "./regime-gate.js";
import { ConfidenceCalibrator } from "../learning/calibration.js";
import { getSentiment } from "../sentiment/index.js";
import { getAccuracyTuning, isMaxAccuracy } from "../config/accuracy-profile.js";
import { applyAccuracyFilter } from "./accuracy-filter.js";

const DEFAULT_HORIZON_SEC = 30;
const MAX_PRICES = 400;

export interface PredictionEngineOptions {
  horizonSec?: number;
}

export class PredictionEngine {
  readonly horizonSec: number;
  readonly ml = new OnlineMLModel();
  readonly mlp = new MLPModel();
  readonly gbm = new GBMModel();
  readonly calibrator = new ConfidenceCalibrator();

  private prices: number[] = [];
  private volumes: number[] = [];
  private weights: StrategyWeights = {};
  private ready = false;

  constructor(options: PredictionEngineOptions = {}) {
    this.horizonSec =
      options.horizonSec ??
      Number(process.env.ZAMBAHOLA_HORIZON_SEC ?? getAccuracyTuning().horizonSec);
  }

  async init(): Promise<void> {
    this.weights = await loadStrategyWeights(ALL_STRATEGIES.map((s) => s.id));
    const orch = await loadOrchestratorWeights();
    if (orch) this.weights = { ...this.weights, ...orch };
    await this.ml.load();
    await this.mlp.load();
    await this.gbm.load();
    await this.calibrator.load();
    this.ready = true;
  }

  seedHistory(prices: number[], volumes: number[]): void {
    this.prices = prices.slice(-MAX_PRICES);
    this.volumes = volumes.slice(-MAX_PRICES);
  }

  predict(tick: MarketTick): Prediction {
    const prev = this.prices[this.prices.length - 1];
    const volProxy = prev ? Math.abs(tick.price - prev) * 10 + 1 : tick.price * 0.00001;

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
    const lob = lobCnnPredict();

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
    let gbmScore = 0;
    let gbmProb = 0.5;
    let lobScore = lob.score;
    let regime = "range" as ReturnType<typeof detectRegime>;
    let gateReason = "n/a";
    let qualityTier: "high" | "medium" | "abstain" = "medium";

    if (features) {
      const logit = this.ml.predict(features);
      const deep = this.mlp.predict(features);
      const gbm = this.gbm.predict(features);
      mlScore = logit.score;
      mlProb = logit.prob;
      mlpScore = deep.score;
      mlpProb = deep.prob;
      gbmScore = gbm.score;
      gbmProb = gbm.prob;
      regime = detectRegime(features);

      const blended = blendMega(
        ensemble.direction,
        ensemble.confidence,
        logit.direction,
        logit.prob,
        deep.direction,
        deep.prob,
        gbm.direction,
        gbm.prob,
        lob.direction,
        lob.confidence,
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

      const filtered = applyAccuracyFilter({
        direction,
        confidence,
        agreement: ensemble.agreement,
        mlProb,
        mlpProb,
        gbmProb,
        lobReady: lob.ready,
        regime,
        blocked: gated.blocked,
        mlSamples: this.ml.getSampleCount(),
      });
      direction = filtered.direction;
      confidence = filtered.confidence;
      qualityTier = filtered.qualityTier;
      gateReason = `${gateReason} | ${filtered.filterReason}`;
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
        engine: isMaxAccuracy() ? "hybrid_v7_max" : "hybrid_v7",
        accuracyMode: isMaxAccuracy() ? "max" : "normal",
        qualityTier,
        strategyCount: STRATEGY_COUNT,
        agreement: ensemble.agreement,
        strategyVotes: ensemble.votes,
        weights: { ...this.weights },
        regime,
        gateReason,
        mlScore,
        mlProb,
        mlpScore,
        mlpProb,
        gbmScore,
        gbmProb,
        lobScore,
        lobReady: lob.ready,
        mlSamples: this.ml.getSampleCount(),
        mlpSamples: this.mlp.getSampleCount(),
        gbmSamples: this.gbm.getSampleCount(),
        sentiment: sentiment.score,
        sentimentLabel: sentiment.label,
        features: features ? { ...features } : undefined,
      },
    };
  }

  async onEvaluationHit(
    features: FeatureVector | Record<string, number> | undefined,
    direction: PredictionDirection,
    hit: boolean,
    rawConfidence: number,
  ): Promise<void> {
    if (features) {
      const label =
        direction === "up" ? (hit ? 1 : 0) : direction === "down" ? (hit ? 0 : 1) : 0.5;
      const fv = features as FeatureVector;
      await this.ml.train(fv, label);
      await this.mlp.train(fv, label);
      await this.gbm.train(fv, label);
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

function blendMega(
  eDir: PredictionDirection,
  eConf: number,
  lDir: PredictionDirection,
  lProb: number,
  mDir: PredictionDirection,
  mProb: number,
  gDir: PredictionDirection,
  gProb: number,
  lobDir: PredictionDirection,
  lobConf: number,
): { direction: PredictionDirection; confidence: number } {
  const s = (d: PredictionDirection, w: number) =>
    d === "up" ? w : d === "down" ? -w : 0;

  const combined =
    s(eDir, eConf) * 0.28 +
    s(lDir, (lProb - 0.5) * 2) * 0.2 +
    s(mDir, (mProb - 0.5) * 2) * 0.22 +
    s(gDir, (gProb - 0.5) * 2) * 0.18 +
    s(lobDir, lobConf) * 0.12;

  let direction: PredictionDirection = "range";
  const blendThr = getAccuracyTuning().blendCombined;
  if (combined > blendThr) direction = "up";
  else if (combined < -blendThr) direction = "down";

  const voters = [eDir, lDir, mDir, gDir, lobDir].filter(
    (d) => d === direction && d !== "range",
  ).length;
  let confidence = Math.min(0.97, Math.abs(combined) * 0.95 + 0.38);
  if (voters >= 3) confidence = Math.min(0.97, confidence + 0.12);
  else if (voters >= 2) confidence = Math.min(0.97, confidence + 0.06);

  return { direction, confidence: Number(confidence.toFixed(4)) };
}
