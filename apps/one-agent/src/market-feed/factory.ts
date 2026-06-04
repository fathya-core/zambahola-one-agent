import type { MarketFeed } from "./types.js";
import { MockMarketFeed } from "./mock-feed.js";
import { HybridBinanceFeed } from "./hybrid-binance.js";
import { BinanceRestFeed } from "./binance-rest.js";
import { UniversalFeed } from "./universal-feed.js";
import { BybitRestFeed } from "./bybit-rest.js";
import { FastTickFeed } from "./fast-tick-feed.js";
import { CoinGeckoFeed } from "./coingecko-feed.js";
import { BybitPrimaryFeed } from "./bybit-primary-feed.js";
import { probeBinanceBlocked } from "../data/exchange-fallback.js";

export type FeedKind =
  | "mock"
  | "binance"
  | "binance_rest"
  | "bybit"
  | "universal"
  | "bybit_primary"
  | "fast"
  | "coingecko";

let feedProbeDone = false;
let useBybitPrimary = process.env.ZAMBAHOLA_BYBIT_PRIMARY === "1";

export function createMarketFeed(kind?: string): MarketFeed {
  let k = (kind ?? process.env.ZAMBAHOLA_FEED ?? "universal").toLowerCase();
  if (process.env.ZAMBAHOLA_FAST === "1" || process.env.ZAMBAHOLA_AUTO_FAST === "1") {
    k = "fast";
  }
  if (k === "mock") return new MockMarketFeed();
  if (k === "coingecko") return new CoinGeckoFeed();
  if (k === "fast") return new FastTickFeed();
  if (k === "binance_rest") return new BinanceRestFeed();
  if (k === "bybit" || k === "bybit_rest") return new BybitRestFeed();
  if (k === "bybit_primary") return new BybitPrimaryFeed();
  if (k === "binance" || k === "binance_ws") return new HybridBinanceFeed();
  if (useBybitPrimary || k === "universal_bybit") return new BybitPrimaryFeed();
  return new UniversalFeed();
}

/** Call once at agent boot to auto-select Bybit-primary when Binance is blocked */
export async function initFeedAutoProbe(): Promise<void> {
  if (feedProbeDone) return;
  feedProbeDone = true;
  if (process.env.ZAMBAHOLA_FEED && process.env.ZAMBAHOLA_FEED !== "universal") return;
  if (process.env.ZAMBAHOLA_BYBIT_PRIMARY === "0") return;
  if (process.env.ZAMBAHOLA_BYBIT_PRIMARY === "1") {
    useBybitPrimary = true;
    return;
  }
  if (process.env.ZAMBAHOLA_AUTO_BYBIT === "1") {
    useBybitPrimary = await probeBinanceBlocked();
  }
}

export function resolveFeedKind(feed: MarketFeed): string {
  return feed.name;
}
