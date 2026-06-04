import type { MarketTick } from "../types.js";
import type { MarketFeed } from "./types.js";
import { BinanceWsFeed } from "./binance-ws.js";
import { BinanceRestFeed } from "./binance-rest.js";

/**
 * Prefer websocket; if no tick in 5s, start REST polling.
 */
export class HybridBinanceFeed implements MarketFeed {
  readonly name = "binance_hybrid";
  readonly symbol = "BTCUSDT";
  private ws = new BinanceWsFeed();
  private rest: BinanceRestFeed | null = null;
  private handlers = new Set<(tick: MarketTick) => void>();
  private lastTickAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  start(): void {
    const relay = (t: MarketTick) => {
      this.lastTickAt = Date.now();
      for (const h of this.handlers) h(t);
    };
    this.ws.onTick(relay);
    this.ws.start();

    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastTickAt > 5000) {
        if (!this.rest) {
          this.rest = new BinanceRestFeed();
          this.rest.onTick(relay);
          this.rest.start();
        }
      }
    }, 2000);
  }

  stop(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.ws.stop();
    this.rest?.stop();
    this.rest = null;
  }

  onTick(handler: (tick: MarketTick) => void): void {
    this.handlers.add(handler);
  }

  offTick(handler: (tick: MarketTick) => void): void {
    this.handlers.delete(handler);
  }
}
