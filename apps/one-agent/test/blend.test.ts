import { describe, it, expect } from "vitest";
import { blendMega } from "../src/prediction-engine/index.js";

describe("blendMega signed blending", () => {
  it("blends aligned UP signals into an up call", () => {
    const r = blendMega("up", 0.8, "up", 0.85, "up", 0.85, "up", 0.85, "up", 0.7);
    expect(r.direction).toBe("up");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("blends aligned DOWN signals into a down call (regression: sign bug)", () => {
    // Every model says DOWN (prob < 0.5). A sign bug would invert these to up.
    const r = blendMega("down", 0.8, "down", 0.15, "down", 0.15, "down", 0.1, "down", 0.7);
    expect(r.direction).toBe("down");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("a strongly-down model is not counted as an up push", () => {
    // Ensemble neutral, GBM strongly down -> result must not be 'up'.
    const r = blendMega("range", 0.5, "range", 0.5, "range", 0.5, "down", 0.05, "range", 0.42);
    expect(r.direction).not.toBe("up");
  });

  it("neutral / no-signal inputs collapse to range", () => {
    const r = blendMega("range", 0.5, "range", 0.5, "range", 0.5, "range", 0.5, "range", 0.42);
    expect(r.direction).toBe("range");
  });

  it("symmetric opposing model votes cancel out (no strong directional)", () => {
    // ML up exactly offsets GBM down at equal magnitude; MLP/LOB neutral.
    const up = blendMega("range", 0.5, "up", 0.8, "range", 0.5, "down", 0.2, "range", 0.42);
    expect(up.direction).toBe("range");
  });
});
