import type { MarketTick } from "../types.js";
import type { MarketFeed } from "./types.js";
import { BybitRestFeed } from "./bybit-rest.js";
import { HybridBinanceFeed } from "./hybrid-binance.js";
import { CoinGeckoFeed } from "./coingecko-feed.js";
import { startDepthPoller } from "./depth-poller.js";

/**
 * Bybit-first universal feed for geo-blocked Binance regions.
 */
export class BybitPrimaryFeed implements MarketFeed {
  readonly name = "bybit_primary";
  readonly symbol = "BTCUSDT";
  private primary = new BybitRestFeed();
  private binance = new HybridBinanceFeed();
  private coingecko = new CoinGeckoFeed();
  private active: MarketFeed;
  private handlers = new Set<(tick: MarketTick) => void>();
  private lastTickAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private stopDepth: (() => void) | null = null;
  private stage: "bybit" | "binance" | "coingecko" = "bybit";

  constructor() {
    this.active = this.primary;
  }

  start(): void {
    const relay = (t: MarketTick) => {
      this.lastTickAt = Date.now();
      for (const h of this.handlers) h(t);
    };
    this.active.onTick(relay);
    this.active.start();
    this.stopDepth = startDepthPoller(
      Number(process.env.ZAMBAHOLA_DEPTH_MS ?? 1200),
    );

    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastTickAt > 8000 && this.stage === "bybit") {
        this.stage = "binance";
        this.active = this.binance;
        this.binance.onTick(relay);
        this.binance.start();
      }
      if (Date.now() - this.lastTickAt > 14000 && this.stage !== "coingecko") {
        this.stage = "coingecko";
        this.coingecko.onTick(relay);
        this.coingecko.start();
      }
    }, 3000);
  }

  stop(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.stopDepth?.();
    this.primary.stop();
    this.binance.stop();
    this.coingecko.stop();
  }

  onTick(handler: (tick: MarketTick) => void): void {
    this.handlers.add(handler);
  }

  offTick(handler: (tick: MarketTick) => void): void {
    this.handlers.delete(handler);
  }
}
