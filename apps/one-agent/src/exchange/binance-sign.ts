import { createHmac } from "node:crypto";

export function binanceBaseUrl(): string {
  const mode = process.env.ZAMBAHOLA_BROKER ?? "paper";
  const testnet = process.env.ZAMBAHOLA_BINANCE_TESTNET !== "0";
  if (mode === "binance_live") {
    return "https://fapi.binance.com";
  }
  if (mode === "binance_demo" || testnet) {
    return "https://testnet.binancefuture.com";
  }
  return "https://testnet.binancefuture.com";
}

export function signQuery(
  params: Record<string, string | number>,
  secret: string,
): string {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const sig = createHmac("sha256", secret).update(qs).digest("hex");
  return `${qs}&signature=${sig}`;
}

export async function binanceSignedPost(
  path: string,
  params: Record<string, string | number>,
  apiKey: string,
  apiSecret: string,
): Promise<unknown> {
  const body = signQuery({ ...params, timestamp: Date.now() }, apiSecret);
  const url = `${binanceBaseUrl()}${path}?${body}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-MBX-APIKEY": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`binance_${res.status}:${text.slice(0, 200)}`);
  return JSON.parse(text) as unknown;
}
