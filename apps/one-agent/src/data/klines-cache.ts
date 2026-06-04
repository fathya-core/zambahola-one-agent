import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isExchangeBlocked } from "./exchange-fallback.js";
import { fetchBybitKlines } from "./bybit-klines.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE_FILE = join(pkgRoot, "data", "klines", "btcusdt-1m.json");
const MEGA_CACHE = join(pkgRoot, "data", "klines", "btcusdt-1m-mega.json");
const ULTRA_CACHE = join(pkgRoot, "data", "klines", "btcusdt-1m-ultra.json");

export interface KlineBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: number;
}

export async function fetchKlinesBatch(
  limit: number,
  endTime?: number,
): Promise<KlineBar[]> {
  const batch = Math.min(1000, limit);
  const url = new URL("https://api.binance.com/api/v3/klines");
  url.searchParams.set("symbol", "BTCUSDT");
  url.searchParams.set("interval", "1m");
  url.searchParams.set("limit", String(batch));
  if (endTime) url.searchParams.set("endTime", String(endTime));

  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (!res.ok || isExchangeBlocked(text)) {
    throw new Error("binance_klines_blocked");
  }
  const raw = JSON.parse(text) as number[][];
  return raw.map((c) => ({
    openTime: c[0]!,
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5]),
  }));
}

/** Paginate up to 5000 1m candles */
export async function fetchKlinesUltra(target = 5000): Promise<KlineBar[]> {
  return fetchKlinesPaginated(target, 12);
}

/** Paginate up to 1500 1m candles */
export async function fetchKlinesMega(target = 1500): Promise<KlineBar[]> {
  return fetchKlinesPaginated(target, 6);
}

async function fetchKlinesPaginated(target: number, maxRounds: number): Promise<KlineBar[]> {
  const all: KlineBar[] = [];
  let endTime: number | undefined;

  let rounds = 0;
  while (all.length < target && rounds < maxRounds) {
    rounds += 1;
    const need = Math.min(1000, target - all.length);
    const batch = await fetchKlinesBatch(need, endTime);
    if (batch.length === 0) break;
    const merged = [...batch, ...all].sort((a, b) => a.openTime - b.openTime);
    const dedup = dedupeBars(merged);
    all.length = 0;
    all.push(...dedup);
    endTime = batch[0]!.openTime - 1;
    if (batch.length < need) break;
    await new Promise((r) => setTimeout(r, 120));
  }

  return all.slice(-target);
}

function dedupeBars(bars: KlineBar[]): KlineBar[] {
  const m = new Map<number, KlineBar>();
  for (const b of bars) m.set(b.openTime, b);
  return [...m.values()].sort((a, b) => a.openTime - b.openTime);
}

export async function loadOrFetchKlines(limit = 500): Promise<{
  bars: KlineBar[];
  source: string;
}> {
  const file =
    limit > 2500 ? ULTRA_CACHE : limit > 800 ? MEGA_CACHE : CACHE_FILE;
  await mkdir(dirname(file), { recursive: true });

  if (existsSync(file)) {
    try {
      const cached = JSON.parse(await readFile(file, "utf8")) as {
        bars: KlineBar[];
        fetchedAt: number;
      };
      if (Date.now() - cached.fetchedAt < 7200_000 && cached.bars.length >= limit * 0.85) {
        return { bars: cached.bars.slice(-limit), source: "cache" };
      }
    } catch {
      /* */
    }
  }

  try {
    let bars: KlineBar[];
    let source: string;
    try {
      bars =
        limit > 2500
          ? await fetchKlinesUltra(limit)
          : limit > 800
            ? await fetchKlinesMega(limit)
            : await fetchKlinesBatch(limit);
      source =
        limit > 2500 ? "binance_ultra" : limit > 800 ? "binance_mega" : "binance_api";
    } catch {
      bars = await fetchBybitKlines(Math.min(limit, 1000));
      source = "bybit_api";
    }
    await writeFile(
      file,
      JSON.stringify({ bars, fetchedAt: Date.now() }, null, 0),
      "utf8",
    );
    return { bars, source };
  } catch {
    return { bars: syntheticBars(limit), source: "synthetic_fallback" };
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
