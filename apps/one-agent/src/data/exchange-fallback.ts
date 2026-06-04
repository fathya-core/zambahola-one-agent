/** Detect geo/API blocks and log source for operators */

export function isExchangeBlocked(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes("restricted location") ||
    lower.includes("cloudfront") ||
    lower.includes("block access") ||
    lower.includes('"code":0')
  );
}

let binanceBlockedCache: boolean | null = null;

/** One-shot probe — cache result for process lifetime */
export async function probeBinanceBlocked(): Promise<boolean> {
  if (binanceBlockedCache !== null) return binanceBlockedCache;
  const url =
    "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1";
  const data = await fetchJsonSafe(url, 8000);
  binanceBlockedCache = data === null;
  return binanceBlockedCache;
}

export async function fetchJsonSafe(url: string, timeoutMs = 12000): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok || isExchangeBlocked(text)) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
