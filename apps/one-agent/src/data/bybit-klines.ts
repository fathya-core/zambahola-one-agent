import type { KlineBar } from "./klines-cache.js";

export async function fetchBybitKlines(limit: number): Promise<KlineBar[]> {
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=1&limit=${Math.min(1000, limit)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (text.includes("CloudFront") || text.includes("block access")) {
    throw new Error("bybit_geo_blocked");
  }
  const data = (await res.json()) as {
    result?: { list?: string[][] };
  };
  const list = data.result?.list ?? [];
  return list
    .map((c) => ({
      openTime: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]),
    }))
    .reverse();
}
