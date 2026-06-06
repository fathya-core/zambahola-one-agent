import { computeImbalance, setOrderBook } from "./orderbook.js";

const URL =
  "https://api.bybit.com/v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=25";

export function startBybitDepthPoller(intervalMs = 2500): () => void {
  const poll = async () => {
    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(5000) });
      const data = (await res.json()) as {
        result?: {
          b?: [string, string][];
          a?: [string, string][];
        };
      };
      const bids = data.result?.b ?? [];
      const asks = data.result?.a ?? [];
      const { bidVol, askVol, imbalance, imbalance5, imbalance20, mid, spreadBps } =
        computeImbalance(bids, asks);
      const existing = Date.now();
      setOrderBook({
        symbol: "BTCUSDT",
        bidVolume: bidVol,
        askVolume: askVol,
        imbalance,
        imbalance5,
        imbalance20,
        spreadBps,
        midPrice: mid,
        updatedAt: existing,
        source: "bybit_depth",
      });
    } catch {
      /* */
    }
  };
  void poll();
  const t = setInterval(() => void poll(), intervalMs);
  return () => clearInterval(t);
}
