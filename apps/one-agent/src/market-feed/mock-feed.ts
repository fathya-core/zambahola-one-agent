import { randomUUID } from "node:crypto";
import type { MarketTick } from "../types.js";
import type { MarketFeed } from "./types.js";

const SYMBOL = "BTCUSDT";

/** Mock BTCUSDT feed — replace with Binance/Bybit websocket adapter later. */
export class MockMarketFeed implements MarketFeed {
  readonly name = "mock";
  readonly symbol = SYMBOL;
  private interval: ReturnType<typeof setInterval> | null = null;
  private handlers = new Set<(tick: MarketTick) => void>();
  private price = 97_000 + Math.random() * 500;
  private tickSeq = 0;

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      const drift = (Math.random() - 0.5) * 120;
      this.price = Math.max(1, this.price + drift);
      this.tickSeq += 1;
      const tick: MarketTick = {
        tickId: `tick-${this.tickSeq}-${randomUUID().slice(0, 8)}`,
        symbol: this.symbol,
        price: Number(this.price.toFixed(2)),
        timestamp: Date.now(),
      };
      for (const handler of this.handlers) {
        handler(tick);
      }
    }, 1000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  onTick(handler: (tick: MarketTick) => void): void {
    this.handlers.add(handler);
  }

  offTick(handler: (tick: MarketTick) => void): void {
    this.handlers.delete(handler);
  }
}
