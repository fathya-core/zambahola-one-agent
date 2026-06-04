import type { MarketFeed } from "./types.js";
import { MockMarketFeed } from "./mock-feed.js";
import { HybridBinanceFeed } from "./hybrid-binance.js";
import { BinanceRestFeed } from "./binance-rest.js";

export type FeedKind = "mock" | "binance" | "binance_ws" | "binance_rest";

export function createMarketFeed(kind?: string): MarketFeed {
  const k = (kind ?? process.env.ZAMBAHOLA_FEED ?? "binance").toLowerCase();
  if (k === "mock") return new MockMarketFeed();
  if (k === "binance_rest") return new BinanceRestFeed();
  if (k === "binance" || k === "binance_ws") return new HybridBinanceFeed();
  return new HybridBinanceFeed();
}

export function resolveFeedKind(feed: MarketFeed): string {
  return feed.name;
}
