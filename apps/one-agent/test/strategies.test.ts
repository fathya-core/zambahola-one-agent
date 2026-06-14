import { describe, it, expect } from "vitest";
import { ALL_STRATEGIES, STRATEGY_COUNT } from "../src/prediction-engine/strategies/index.js";
import { momentumStrategy } from "../src/prediction-engine/strategies/momentum.js";
import { rsiStrategy } from "../src/prediction-engine/strategies/rsi.js";
import type { StrategyContext } from "../src/prediction-engine/strategies/types.js";

const DIRS = new Set(["up", "down", "range"]);

function ctxFrom(prices: number[]): StrategyContext {
  return {
    prices,
    volumes: prices.map(() => 1),
    currentPrice: prices[prices.length - 1]!,
  };
}

const rising = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
const falling = Array.from({ length: 40 }, (_, i) => 100 - i * 0.5);
const flat = Array.from({ length: 40 }, () => 100);

describe("strategy registry", () => {
  it("exposes exactly 17 strategies with unique ids", () => {
    expect(STRATEGY_COUNT).toBe(17);
    const ids = new Set(ALL_STRATEGIES.map((s) => s.id));
    expect(ids.size).toBe(17);
  });
});

describe("every strategy returns a valid signal", () => {
  for (const strat of ALL_STRATEGIES) {
    it(`${strat.id} returns a well-formed signal on all regimes`, () => {
      for (const series of [rising, falling, flat]) {
        const sig = strat.evaluate(ctxFrom(series));
        expect(sig.strategyId).toBe(strat.id);
        expect(DIRS.has(sig.direction)).toBe(true);
        expect(sig.confidence).toBeGreaterThanOrEqual(0);
        expect(sig.confidence).toBeLessThanOrEqual(1);
        expect(typeof sig.reason).toBe("string");
      }
    });

    it(`${strat.id} survives a warmup-length series`, () => {
      const sig = strat.evaluate(ctxFrom([100, 100, 101]));
      expect(DIRS.has(sig.direction)).toBe(true);
    });
  }
});

describe("price-based strategies react to trend direction", () => {
  it("momentum is up on a rising series and down on a falling series", () => {
    expect(momentumStrategy.evaluate(ctxFrom(rising)).direction).toBe("up");
    expect(momentumStrategy.evaluate(ctxFrom(falling)).direction).toBe("down");
  });

  it("rsi fades extremes (down when overbought, up when oversold)", () => {
    expect(rsiStrategy.evaluate(ctxFrom(rising)).direction).toBe("down");
    expect(rsiStrategy.evaluate(ctxFrom(falling)).direction).toBe("up");
  });
});
