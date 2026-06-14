import { describe, it, expect } from "vitest";
import { computeHitBand, isPredictionHit, horizonBarsAhead } from "../src/learning/hit-eval.js";

describe("computeHitBand", () => {
  it("is positive and scales with price", () => {
    const a = computeHitBand(10_000);
    const b = computeHitBand(100_000);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });

  it("widens with higher volatility", () => {
    const calm = computeHitBand(50_000, 0.0002);
    const wild = computeHitBand(50_000, 0.01);
    expect(wild).toBeGreaterThanOrEqual(calm);
  });
});

describe("isPredictionHit", () => {
  const band = 10;

  it("up hits only when change exceeds the band", () => {
    expect(isPredictionHit("up", 15, band)).toBe(true);
    expect(isPredictionHit("up", 5, band)).toBe(false);
    expect(isPredictionHit("up", -15, band)).toBe(false);
  });

  it("down hits only when change is below the negative band", () => {
    expect(isPredictionHit("down", -15, band)).toBe(true);
    expect(isPredictionHit("down", -5, band)).toBe(false);
    expect(isPredictionHit("down", 15, band)).toBe(false);
  });

  it("range hits only inside the band", () => {
    expect(isPredictionHit("range", 5, band)).toBe(true);
    expect(isPredictionHit("range", -5, band)).toBe(true);
    expect(isPredictionHit("range", 15, band)).toBe(false);
  });

  it("property: exactly one direction is correct for any change outside the band", () => {
    for (const change of [-50, -11, 11, 50, 200, -200]) {
      const hits = (["up", "down", "range"] as const).filter((d) =>
        isPredictionHit(d, change, band),
      );
      expect(hits.length).toBe(1);
    }
  });
});

describe("horizonBarsAhead", () => {
  it("maps seconds to at least one 1m bar", () => {
    expect(horizonBarsAhead(10)).toBe(1);
    expect(horizonBarsAhead(60)).toBe(1);
    expect(horizonBarsAhead(180)).toBe(3);
  });
});
