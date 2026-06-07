import type { StrategyWeights } from "./adaptive-weights.js";
import { getPatternJournal } from "./pattern-journal.js";

/** Boost strategies that work in the current regime (from pattern journal) */
export async function boostFromPatternJournal(
  regime: string,
  base: StrategyWeights,
): Promise<StrategyWeights> {
  const journal = await getPatternJournal();
  const minTotal = Number(process.env.ZAMBAHOLA_PATTERN_BOOST_MIN_SAMPLES ?? 15);
  const minHit = Number(process.env.ZAMBAHOLA_PATTERN_BOOST_MIN_HIT ?? 0.42);

  const ranked = Object.entries(journal.byRegimeStrategy)
    .filter(([key]) => key.startsWith(`${regime}:`))
    .map(([key, b]) => ({
      strategyId: key.split(":")[1]!,
      hitRate: b.hitRate,
      total: b.total,
    }))
    .filter((r) => r.total >= minTotal && r.hitRate >= minHit)
    .sort((a, b) => b.hitRate - a.hitRate)
    .slice(0, Number(process.env.ZAMBAHOLA_PATTERN_BOOST_TOP ?? 6));

  if (ranked.length === 0) return base;

  const out = { ...base };
  for (const sid of Object.keys(out)) {
    out[sid] = Math.max(0.3, (out[sid] ?? 1) * 0.96);
  }
  for (const r of ranked) {
    const boost = 1.06 + r.hitRate * 0.2;
    out[r.strategyId] = Math.min(4, (out[r.strategyId] ?? 1) * boost);
  }
  return out;
}
