import { describe, it, expect } from "vitest";
import { FEATURE_DIM, featuresToArray, type FeatureVector } from "../src/features/index.js";

const zeroFeatures: FeatureVector = {
  ret1: 0,
  ret5: 0,
  ret10: 0,
  volatility: 0,
  rsiNorm: 0,
  momentumNorm: 0,
  zScore: 0,
  sentiment: 0,
  agreement: 0,
  bookImbalance: 0,
  spreadBps: 0,
  macdHistNorm: 0,
  fundingNorm: 0,
  premiumNorm: 0,
  longShortNorm: 0,
  volumeNorm: 0,
  timeSin: 0,
  timeCos: 0,
};

describe("features", () => {
  it("featuresToArray prepends a bias term", () => {
    const arr = featuresToArray(zeroFeatures);
    // 18 features + 1 bias = 19
    expect(arr.length).toBe(FEATURE_DIM + 1);
    expect(arr[0]).toBe(1);
  });
});
