import { recordLobSnapshot } from "./lob-history.js";

export interface OrderBookSnapshot {
  symbol: string;
  bidVolume: number;
  askVolume: number;
  imbalance: number;
  /** Top-5 level imbalance */
  imbalance5: number;
  /** Top-20 level imbalance */
  imbalance20: number;
  spreadBps: number;
  midPrice: number;
  updatedAt: number;
  source: string;
}

let snapshot: OrderBookSnapshot | null = null;

export function setOrderBook(s: OrderBookSnapshot): void {
  snapshot = s;
  recordLobSnapshot(s.imbalance, s.spreadBps);
}

export function getOrderBook(): OrderBookSnapshot | null {
  return snapshot;
}

export function computeImbalance(
  bids: Array<[string, string]>,
  asks: Array<[string, string]>,
  levels = 10,
): {
  bidVol: number;
  askVol: number;
  imbalance: number;
  imbalance5: number;
  imbalance20: number;
  mid: number;
  spreadBps: number;
} {
  const imbAt = (n: number) => {
    let bidVol = 0;
    let askVol = 0;
    for (let i = 0; i < Math.min(n, bids.length); i++) bidVol += Number(bids[i]![1]);
    for (let i = 0; i < Math.min(n, asks.length); i++) askVol += Number(asks[i]![1]);
    const total = bidVol + askVol || 1;
    return (bidVol - askVol) / total;
  };

  let bidVol = 0;
  let askVol = 0;
  for (let i = 0; i < Math.min(levels, bids.length); i++) {
    bidVol += Number(bids[i]![1]);
  }
  for (let i = 0; i < Math.min(levels, asks.length); i++) {
    askVol += Number(asks[i]![1]);
  }
  const bestBid = Number(bids[0]?.[0] ?? 0);
  const bestAsk = Number(asks[0]?.[0] ?? 0);
  const mid = (bestBid + bestAsk) / 2;
  const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 0;
  const total = bidVol + askVol || 1;
  return {
    bidVol,
    askVol,
    imbalance: (bidVol - askVol) / total,
    imbalance5: imbAt(5),
    imbalance20: imbAt(20),
    mid,
    spreadBps,
  };
}
