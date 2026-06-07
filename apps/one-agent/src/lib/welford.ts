/** Sliding-window Welford for streaming z-scores (research: vadim.blog OFI normalization) */

export class WelfordWindow {
  private readonly buf: number[] = [];

  constructor(
    private readonly maxLen: number,
    private readonly minStd = 1e-6,
  ) {}

  push(v: number): void {
    this.buf.push(v);
    if (this.buf.length > this.maxLen) this.buf.shift();
  }

  size(): number {
    return this.buf.length;
  }

  zScore(v: number): number {
    if (this.buf.length < 8) return 0;
    const n = this.buf.length;
    const mean = this.buf.reduce((a, b) => a + b, 0) / n;
    const variance =
      this.buf.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1);
    const std = Math.sqrt(variance) || this.minStd;
    const z = (v - mean) / Math.max(std, this.minStd);
    return Math.max(-3, Math.min(3, z));
  }
}
