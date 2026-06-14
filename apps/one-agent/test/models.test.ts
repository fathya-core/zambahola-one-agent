import { describe, it, expect } from "vitest";
import { INPUT_DIM, FEATURE_DIM, type FeatureVector } from "../src/features/index.js";
import {
  freshMlpState,
  isValidMlpShape,
  normalizeMlWeights,
  isDeadMlWeights,
  ML_DEFAULT_WEIGHTS,
} from "../src/learning/model-weight-health.js";
import { MLPModel } from "../src/prediction-engine/mlp-model.js";
import { OnlineMLModel } from "../src/prediction-engine/ml-model.js";
import { GBMModel } from "../src/prediction-engine/gbm-model.js";

const MLP_H1 = 16;
const MLP_H2 = 8;

// A clearly "up-leaning" feature row (positive momentum / returns).
const upFeatures: FeatureVector = {
  ret1: 0.4,
  ret5: 0.4,
  ret10: 0.4,
  volatility: 0.2,
  rsiNorm: 0.6,
  momentumNorm: 0.8,
  zScore: 1.2,
  sentiment: 0.5,
  agreement: 0.7,
  bookImbalance: 0.5,
  spreadBps: 0.1,
  macdHistNorm: 0.6,
  fundingNorm: 0.2,
  premiumNorm: 0.2,
  longShortNorm: 0.3,
  volumeNorm: 0.4,
  timeSin: 0.5,
  timeCos: 0.5,
  ret20: 0.4,
  deepImbalance: 0.5,
  bookImbalanceDelta: 0.4,
  vwapDevNorm: 0.3,
  oiChangeNorm: 0.2,
  volAccel: 0.1,
};

describe("feature dimensions", () => {
  it("INPUT_DIM is FEATURE_DIM + 1 (bias term)", () => {
    expect(INPUT_DIM).toBe(FEATURE_DIM + 1);
  });
});

describe("MLP weight shapes", () => {
  it("freshMlpState has correctly oriented matrices", () => {
    const s = freshMlpState();
    expect(s.W1.length).toBe(MLP_H1);
    expect(s.W1[0]!.length).toBe(INPUT_DIM);
    expect(s.W2.length).toBe(MLP_H2);
    expect(s.W2[0]!.length).toBe(MLP_H1);
    expect(s.W3.length).toBe(MLP_H2);
    expect(s.b1.length).toBe(MLP_H1);
    expect(s.b2.length).toBe(MLP_H2);
  });

  it("isValidMlpShape accepts fresh state and rejects legacy swapped dims", () => {
    expect(isValidMlpShape(freshMlpState())).toBe(true);
    // Legacy bug: W1 was [FEATURE_DIM][H1] = [18][16]
    const legacy = {
      W1: Array.from({ length: FEATURE_DIM }, () => new Array(MLP_H1).fill(0.01)),
      b1: new Array(MLP_H1).fill(0),
      W2: Array.from({ length: MLP_H1 }, () => new Array(MLP_H2).fill(0.01)),
      b2: new Array(MLP_H2).fill(0),
      W3: new Array(MLP_H2).fill(0.01),
      b3: 0,
    };
    expect(isValidMlpShape(legacy)).toBe(false);
  });
});

describe("ML weight normalization / migration", () => {
  it("default ML weights have one entry per input dimension", () => {
    expect(ML_DEFAULT_WEIGHTS.length).toBe(INPUT_DIM);
  });

  it("pads legacy FEATURE_DIM-length weights to INPUT_DIM", () => {
    const legacy = new Array(FEATURE_DIM).fill(0.1);
    const norm = normalizeMlWeights(legacy);
    expect(norm).not.toBeNull();
    expect(norm!.length).toBe(INPUT_DIM);
  });

  it("flags all-zero weights as dead", () => {
    expect(isDeadMlWeights(new Array(INPUT_DIM).fill(0))).toBe(true);
    expect(isDeadMlWeights([...ML_DEFAULT_WEIGHTS])).toBe(false);
  });
});

describe("models are not stuck at 0.5", () => {
  it("MLP moves probability after learning an up signal (no disk save)", async () => {
    const mlp = new MLPModel(); // fresh, never load() — avoids touching disk
    const before = mlp.predict(upFeatures).prob;
    // Stay strictly below the %5 save threshold so the live file is untouched.
    for (let i = 0; i < 4; i++) await mlp.train(upFeatures, 1);
    const after = mlp.predict(upFeatures).prob;
    expect(Number.isFinite(before)).toBe(true);
    expect(Number.isFinite(after)).toBe(true);
    expect(after).toBeGreaterThan(before);
  });

  it("ML logistic moves probability up after up-labeled training (no disk save)", async () => {
    const ml = new OnlineMLModel();
    const before = ml.predict(upFeatures).prob;
    for (let i = 0; i < 2; i++) await ml.train(upFeatures, 1); // below %3 save
    const after = ml.predict(upFeatures).prob;
    expect(after).toBeGreaterThan(before);
  });

  it("GBM leaves 0.5 once a tree is added (no disk save)", async () => {
    const gbm = new GBMModel();
    expect(gbm.predict(upFeatures).prob).toBeCloseTo(0.5, 5);
    for (let i = 0; i < 4; i++) await gbm.train(upFeatures, 1); // below %8 save
    expect(gbm.predict(upFeatures).prob).not.toBeCloseTo(0.5, 5);
  });
});
