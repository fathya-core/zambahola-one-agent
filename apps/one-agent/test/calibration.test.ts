import { describe, it, expect } from "vitest";
import { ConfidenceCalibrator } from "../src/learning/calibration.js";

// record() mutates in-memory buckets only; save() is never called so no disk I/O.
function feed(cal: ConfidenceCalibrator, conf: number, hitRate: number, n: number): void {
  const hits = Math.round(n * hitRate);
  for (let i = 0; i < n; i++) cal.record(conf, i < hits);
}

describe("ConfidenceCalibrator isotonic recalibration", () => {
  it("passes confidence through until it has enough samples", () => {
    const cal = new ConfidenceCalibrator();
    feed(cal, 0.7, 0.9, 10);
    expect(cal.calibrate(0.7)).toBe(0.7);
  });

  it("corrects a monotonic-but-distorted confidence mapping", () => {
    const cal = new ConfidenceCalibrator();
    // Stated 35% actually wins 10%; 55% wins 50%; 75% wins 90%.
    feed(cal, 0.35, 0.1, 200);
    feed(cal, 0.55, 0.5, 200);
    feed(cal, 0.75, 0.9, 200);

    const low = cal.calibrate(0.35);
    const high = cal.calibrate(0.75);
    // Overconfidence at the low bucket is pulled down; ordering preserved.
    expect(low).toBeLessThan(0.35);
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
  });

  it("produces a non-decreasing calibrated reliability curve (PAVA)", () => {
    const cal = new ConfidenceCalibrator();
    // Deliberately non-monotonic empirical rates.
    feed(cal, 0.25, 0.6, 150);
    feed(cal, 0.45, 0.3, 150);
    feed(cal, 0.65, 0.7, 150);
    feed(cal, 0.85, 0.4, 150);

    const curve = cal.getReliabilityCurve().filter((b) => b.count > 0);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.calibrated).toBeGreaterThanOrEqual(curve[i - 1]!.calibrated - 1e-9);
    }
  });

  it("calibrate is monotonic non-decreasing in raw confidence", () => {
    const cal = new ConfidenceCalibrator();
    feed(cal, 0.25, 0.2, 200);
    feed(cal, 0.55, 0.5, 200);
    feed(cal, 0.85, 0.85, 200);
    let prev = -1;
    for (let r = 0; r <= 1.0001; r += 0.1) {
      const c = cal.calibrate(r);
      expect(c).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = c;
    }
  });

  it("reports miscalibration that decreases for well-calibrated input", () => {
    const good = new ConfidenceCalibrator();
    feed(good, 0.25, 0.25, 200);
    feed(good, 0.75, 0.75, 200);
    const bad = new ConfidenceCalibrator();
    feed(bad, 0.25, 0.9, 200);
    feed(bad, 0.75, 0.1, 200);
    expect(good.getMiscalibration()).toBeLessThan(bad.getMiscalibration());
  });
});
