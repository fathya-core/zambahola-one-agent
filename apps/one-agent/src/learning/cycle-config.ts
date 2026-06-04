/** Learning cycle presets — override via env */

export const CYCLES = {
  learn: Number(process.env.ZAMBAHOLA_LEARN_CYCLES ?? 25),
  power: Number(process.env.ZAMBAHOLA_POWER_CYCLES ?? 20),
  deep: Number(process.env.ZAMBAHOLA_DEEP_CYCLES ?? 25),
  ultra: Number(process.env.ZAMBAHOLA_ULTRA_CYCLES ?? 30),
  cycleMs: Number(process.env.ZAMBAHOLA_CYCLE_MS ?? 65_000),
  megaBars: Number(process.env.ZAMBAHOLA_KLINES ?? 3000),
  ultraBars: Number(process.env.ZAMBAHOLA_ULTRA_KLINES ?? 5000),
} as const;
