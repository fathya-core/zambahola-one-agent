import { randomUUID } from "node:crypto";
import type { Prediction, PredictionEvaluation } from "../types.js";

interface PendingEval {
  prediction: Prediction;
  evaluateAt: number;
}

import { computeHitBand, isPredictionHit } from "../learning/hit-eval.js";

export class Evaluator {
  private pending: PendingEval[] = [];
  private evaluations: PredictionEvaluation[] = [];

  schedule(prediction: Prediction): void {
    this.pending.push({
      prediction,
      evaluateAt: prediction.timestamp + prediction.horizonSec * 1000,
    });
  }

  onPrice(
    price: number,
    now = Date.now(),
  ): Array<{ evaluation: PredictionEvaluation; prediction: Prediction }> {
    const done: Array<{ evaluation: PredictionEvaluation; prediction: Prediction }> =
      [];
    const stillPending: PendingEval[] = [];

    for (const item of this.pending) {
      if (now >= item.evaluateAt) {
        const evaluation = this.evaluate(item.prediction, price, now);
        this.evaluations.push(evaluation);
        done.push({ evaluation, prediction: item.prediction });
      } else {
        stillPending.push(item);
      }
    }

    this.pending = stillPending;
    return done;
  }

  getEvaluations(): PredictionEvaluation[] {
    return [...this.evaluations];
  }

  getHitRate(): number {
    if (this.evaluations.length === 0) return 0;
    const hits = this.evaluations.filter((e) => e.predictionHit).length;
    return Number((hits / this.evaluations.length).toFixed(4));
  }

  getDirectionalHitRate(): number {
    const dir = this.evaluations.filter((e) => e.direction !== "range");
    if (dir.length === 0) return 0;
    return Number((dir.filter((e) => e.predictionHit).length / dir.length).toFixed(4));
  }

  getDirectionalCount(): number {
    return this.evaluations.filter((e) => e.direction !== "range").length;
  }

  getAbstainRate(): number {
    if (this.evaluations.length === 0) return 0;
    const range = this.evaluations.filter((e) => e.direction === "range").length;
    return Number((range / this.evaluations.length).toFixed(4));
  }

  getFalsePositiveRate(): number {
    const tradeSignals = this.evaluations.length;
    if (tradeSignals === 0) return 0;
    const misses = this.evaluations.filter((e) => !e.predictionHit).length;
    return Number((misses / tradeSignals).toFixed(4));
  }

  getConfidenceCalibration(): number {
    if (this.evaluations.length === 0) return 0;
    const target = Number(process.env.ZAMBAHOLA_CALIBRATION_TARGET ?? 0.65);
    const hitRate = this.getHitRate();
    return Number((1 - Math.abs(target - hitRate)).toFixed(4));
  }

  private evaluate(
    prediction: Prediction,
    priceAtHorizon: number,
    evaluatedAt: number,
  ): PredictionEvaluation {
    const { priceAtPrediction, direction } = prediction;
    const change = priceAtHorizon - priceAtPrediction;
    // Use the same volatility-aware band as the strategy/weight feedback in
    // agent-core so overall hit metrics and per-strategy attribution agree.
    const volatility = prediction.meta?.features?.volatility;
    const band = computeHitBand(priceAtPrediction, volatility);

    const predictionHit = isPredictionHit(direction, change, band);

    return {
      evaluationId: `eval-${randomUUID()}`,
      predictionId: prediction.predictionId,
      tickId: prediction.tickId,
      direction,
      priceAtPrediction,
      priceAtHorizon,
      horizonSec: prediction.horizonSec,
      predictionHit,
      evaluatedAt,
    };
  }

}
