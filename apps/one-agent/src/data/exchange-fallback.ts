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
