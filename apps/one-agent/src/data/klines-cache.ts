import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE_FILE = join(pkgRoot, "data", "klines", "btcusdt-1m.json");

export interface KlineBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: number;
}

export async function fetchKlines(limit = 500): Promise<KlineBar[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=${Math.min(1000, limit)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const raw = (await res.json()) as number[][];
  return raw.map((c) => ({
    openTime: c[0]!,
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5]),
  }));
}

export async function loadOrFetchKlines(limit = 500): Promise<{
  bars: KlineBar[];
  source: string;
}> {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  if (existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(await readFile(CACHE_FILE, "utf8")) as {
        bars: KlineBar[];
        fetchedAt: number;
      };
      if (Date.now() - cached.fetchedAt < 3600_000 && cached.bars.length >= limit * 0.8) {
        return { bars: cached.bars.slice(-limit), source: "cache" };
      }
    } catch {
      /* refetch */
    }
  }

  try {
    const bars = await fetchKlines(limit);
    await writeFile(
      CACHE_FILE,
      JSON.stringify({ bars, fetchedAt: Date.now() }, null, 0),
      "utf8",
    );
    return { bars, source: "binance_api" };
  } catch {
    return { bars: syntheticBars(limit), source: "synthetic" };
  }
}

function syntheticBars(n: number): KlineBar[] {
  const out: KlineBar[] = [];
  let p = 97000;
  for (let i = 0; i < n; i++) {
    const d = (Math.random() - 0.5) * 100;
    p += d;
    out.push({
      openTime: Date.now() - (n - i) * 60_000,
      open: p - d / 2,
      high: p + Math.abs(d),
      low: p - Math.abs(d),
      close: p,
      volume: 10 + Math.random() * 50,
    });
  }
  return out;
}
