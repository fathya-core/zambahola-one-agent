import { computeImbalance, setOrderBook } from "./orderbook.js";

const BINANCE_DEPTH =
  "https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=20";

let timer: ReturnType<typeof setInterval> | null = null;

export function startDepthPoller(intervalMs = 2000): () => void {
  const poll = async () => {
    try {
      const res = await fetch(BINANCE_DEPTH, { signal: AbortSignal.timeout(5000) });
      const data = (await res.json()) as {
        bids: [string, string][];
        asks: [string, string][];
      };
      const { bidVol, askVol, imbalance, mid, spreadBps } = computeImbalance(
        data.bids,
        data.asks,
      );
      setOrderBook({
        symbol: "BTCUSDT",
        bidVolume: bidVol,
        askVolume: askVol,
        imbalance,
        spreadBps,
        midPrice: mid,
        updatedAt: Date.now(),
        source: "binance_depth",
      });
    } catch {
      /* */
    }
  };
  void poll();
  timer = setInterval(() => void poll(), intervalMs);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
