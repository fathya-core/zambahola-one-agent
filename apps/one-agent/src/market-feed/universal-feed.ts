import type { MarketTick } from "../types.js";
import type { MarketFeed } from "./types.js";
import { HybridBinanceFeed } from "./hybrid-binance.js";
import { BybitRestFeed } from "./bybit-rest.js";
import { startDepthPoller } from "./depth-poller.js";
import { CoinGeckoFeed } from "./coingecko-feed.js";

/**
 * Maximum-power feed: Binance hybrid + order book depth + Bybit failover.
 */
export class UniversalFeed implements MarketFeed {
  readonly name = "universal";
  readonly symbol = "BTCUSDT";
  private primary = new HybridBinanceFeed();
  private fallback = new BybitRestFeed();
  private active: MarketFeed;
  private handlers = new Set<(tick: MarketTick) => void>();
  private lastTickAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private stopDepth: (() => void) | null = null;
  private usingFallback = false;
  private usingCoingecko = false;
  private coingecko = new CoinGeckoFeed();

  constructor() {
    this.active = this.primary;
  }

  start(): void {
    const relay = (t: MarketTick) => {
      this.lastTickAt = Date.now();
      for (const h of this.handlers) h(t);
    };
    this.primary.onTick(relay);
    this.primary.start();
    this.stopDepth = startDepthPoller(1500);

    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastTickAt > 6000 && !this.usingFallback && !this.usingCoingecko) {
        this.usingFallback = true;
        this.active = this.fallback;
        this.fallback.onTick(relay);
        this.fallback.start();
      }
      if (Date.now() - this.lastTickAt > 12000 && !this.usingCoingecko) {
        this.usingCoingecko = true;
        this.coingecko.onTick(relay);
        this.coingecko.start();
      }
    }, 2500);
  }

  stop(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.stopDepth?.();
    this.primary.stop();
    this.fallback.stop();
    this.coingecko.stop();
  }

  onTick(handler: (tick: MarketTick) => void): void {
    this.handlers.add(handler);
  }

  offTick(handler: (tick: MarketTick) => void): void {
    this.handlers.delete(handler);
  }
}
