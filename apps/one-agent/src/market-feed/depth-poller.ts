import { computeImbalance, setOrderBook, getOrderBook } from "./orderbook.js";
import { startBybitDepthPoller } from "./bybit-depth.js";

const BINANCE_DEPTH =
  "https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=20";

let timer: ReturnType<typeof setInterval> | null = null;
let stopBybit: (() => void) | null = null;

async function pollBinance(): Promise<void> {
  try {
    const res = await fetch(BINANCE_DEPTH, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as {
      bids: [string, string][];
      asks: [string, string][];
    };
    const { bidVol, askVol, imbalance, imbalance5, imbalance20, mid, spreadBps } =
      computeImbalance(data.bids, data.asks);
    setOrderBook({
      symbol: "BTCUSDT",
      bidVolume: bidVol,
      askVolume: askVol,
      imbalance,
      imbalance5,
      imbalance20,
      spreadBps,
      midPrice: mid,
      updatedAt: Date.now(),
      source: "binance_depth",
    });
  } catch {
    /* bybit fallback may have set book */
  }
}

export function startDepthPoller(intervalMs = 1500): () => void {
  void pollBinance();
  timer = setInterval(() => void pollBinance(), intervalMs);
  stopBybit = startBybitDepthPoller(3000);
  return () => {
    if (timer) clearInterval(timer);
    stopBybit?.();
    timer = null;
    stopBybit = null;
  };
}

export function mergeBestBook(): void {
  const b = getOrderBook();
  if (b && Date.now() - b.updatedAt < 5000) return;
}
