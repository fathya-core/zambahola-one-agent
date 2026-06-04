import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CAL_FILE = join(pkgRoot, "data", "learning", "calibration.json");

interface Bucket {
  predicted: number;
  actual: number;
  count: number;
}

export class ConfidenceCalibrator {
  private buckets: Bucket[] = Array.from({ length: 10 }, (_, i) => ({
    predicted: (i + 0.5) / 10,
    actual: 0,
    count: 0,
  }));

  async load(): Promise<void> {
    if (!existsSync(CAL_FILE)) return;
    try {
      const data = JSON.parse(await readFile(CAL_FILE, "utf8")) as {
        buckets: Bucket[];
      };
      if (data.buckets?.length === 10) this.buckets = data.buckets;
    } catch {
      /* */
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(CAL_FILE), { recursive: true });
    await writeFile(CAL_FILE, JSON.stringify({ buckets: this.buckets }, null, 2));
  }

  record(confidence: number, hit: boolean): void {
    const idx = Math.min(9, Math.max(0, Math.floor(confidence * 10)));
    const b = this.buckets[idx]!;
    b.count += 1;
    b.actual += hit ? 1 : 0;
  }

  calibrate(raw: number): number {
    const idx = Math.min(9, Math.max(0, Math.floor(raw * 10)));
    const b = this.buckets[idx]!;
    if (b.count < 8) return raw;
    const empirical = b.actual / b.count;
    return Number((raw * 0.4 + empirical * 0.6).toFixed(4));
  }

  getCalibrationScore(): number {
    let err = 0;
    let n = 0;
    for (const b of this.buckets) {
      if (b.count < 5) continue;
      const emp = b.actual / b.count;
      err += Math.abs(b.predicted - emp);
      n += 1;
    }
    return n > 0 ? Number((1 - err / n).toFixed(4)) : 0;
  }
}
