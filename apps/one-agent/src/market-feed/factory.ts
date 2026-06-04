import type { MarketFeed } from "./types.js";
import { MockMarketFeed } from "./mock-feed.js";
import { HybridBinanceFeed } from "./hybrid-binance.js";
import { BinanceRestFeed } from "./binance-rest.js";
import { UniversalFeed } from "./universal-feed.js";
import { BybitRestFeed } from "./bybit-rest.js";
import { FastTickFeed } from "./fast-tick-feed.js";

export type FeedKind =
  | "mock"
  | "binance"
  | "binance_rest"
  | "bybit"
  | "universal"
  | "fast";

export function createMarketFeed(kind?: string): MarketFeed {
  let k = (kind ?? process.env.ZAMBAHOLA_FEED ?? "universal").toLowerCase();
  if (process.env.ZAMBAHOLA_FAST === "1") k = "fast";
  if (k === "mock") return new MockMarketFeed();
  if (k === "fast") return new FastTickFeed();
  if (k === "binance_rest") return new BinanceRestFeed();
  if (k === "bybit" || k === "bybit_rest") return new BybitRestFeed();
  if (k === "binance" || k === "binance_ws") return new HybridBinanceFeed();
  return new UniversalFeed();
}

export function resolveFeedKind(feed: MarketFeed): string {
  return feed.name;
}
