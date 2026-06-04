import { randomUUID } from "node:crypto";
import type { MarketTick } from "../types.js";
import type { MarketFeed } from "./types.js";

const SYMBOL = "BTCUSDT";
const URL = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";

/** REST fallback when websocket is blocked — 1 Hz poll. */
export class BinanceRestFeed implements MarketFeed {
  readonly name = "binance_rest";
  readonly symbol = SYMBOL;
  private interval: ReturnType<typeof setInterval> | null = null;
  private handlers = new Set<(tick: MarketTick) => void>();
  private tickSeq = 0;

  start(): void {
    if (this.interval) return;
    const poll = async () => {
      try {
        const res = await fetch(URL, { signal: AbortSignal.timeout(5000) });
        const data = (await res.json()) as { price: string };
        const price = Number(data.price);
        if (!price) return;
        this.tickSeq += 1;
        const tick: MarketTick = {
          tickId: `bnr-${this.tickSeq}-${randomUUID().slice(0, 8)}`,
          symbol: this.symbol,
          price,
          timestamp: Date.now(),
        };
        for (const h of this.handlers) h(tick);
      } catch {
        /* retry next second */
      }
    };
    void poll();
    this.interval = setInterval(() => void poll(), 1000);
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
