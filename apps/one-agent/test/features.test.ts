import { describe, it, expect } from "vitest";
import {
  extractFeatures,
  featuresToArray,
  normalizeFeatureVector,
  directionFromScore,
  FEATURE_DIM,
  INPUT_DIM,
} from "../src/features/index.js";

const NEW_FIELDS = [
  "ret20",
  "deepImbalance",
  "bookImbalanceDelta",
  "vwapDevNorm",
  "oiChangeNorm",
  "volAccel",
] as const;

describe("feature vector dimensions", () => {
  it("has 24 named features and INPUT_DIM 25 (bias + features)", () => {
    expect(FEATURE_DIM).toBe(24);
    expect(INPUT_DIM).toBe(FEATURE_DIM + 1);
  });
});

describe("extractFeatures", () => {
  it("returns null before warmup (<12 prices)", () => {
    expect(extractFeatures([1, 2, 3], [1, 1, 1])).toBeNull();
  });

  it("produces a finite vector with all new depth features present", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 50_000 + Math.sin(i / 3) * 40 + i);
    const volumes = prices.map(() => 1 + Math.random());
    const f = extractFeatures(prices, volumes, 0.1, 0.5, Date.now());
    expect(f).not.toBeNull();
    const arr = featuresToArray(f!);
    expect(arr.length).toBe(INPUT_DIM);
    expect(arr.every((x) => Number.isFinite(x))).toBe(true);
    for (const field of NEW_FIELDS) {
      expect(Number.isFinite(f![field])).toBe(true);
    }
  });

  it("normalizeFeatureVector fills missing fields with 0", () => {
    const f = normalizeFeatureVector({ ret1: 0.5 } as Record<string, number>);
    expect(f.ret1).toBe(0.5);
    for (const field of NEW_FIELDS) {
      expect(f[field]).toBe(0);
    }
    expect(featuresToArray(f).length).toBe(INPUT_DIM);
  });
});

describe("directionFromScore", () => {
  it("thresholds score into up/down/range", () => {
    expect(directionFromScore(0.5)).toBe("up");
    expect(directionFromScore(-0.5)).toBe("down");
    expect(directionFromScore(0)).toBe("range");
  });
});
