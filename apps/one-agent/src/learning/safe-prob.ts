/** Guard ML outputs — avoid NaN breaking blend + accuracy filter */

export function safeProb(p: number, fallback = 0.5): number {
  if (!Number.isFinite(p)) return fallback;
  return Number(Math.min(0.99, Math.max(0.01, p)).toFixed(4));
}

export function safeScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Number(Math.max(-1, Math.min(1, score)).toFixed(4));
}
