/** Shared numeric primitives for the prediction models (ML, MLP, GBM, meta). */

/** Numerically-stable logistic sigmoid. */
export function sigmoid(z: number): number {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

/** Dot product over the shorter of the two vectors. */
export function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

export function relu(z: number): number {
  return Math.max(0, z);
}

export function reluDeriv(z: number): number {
  return z > 0 ? 1 : 0;
}
