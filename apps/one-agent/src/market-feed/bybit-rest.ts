import { randomUUID } from "node:crypto";
import type { MarketTick } from "../types.js";
import type { MarketFeed } from "./types.js";

const URL =
  "https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT";

export class BybitRestFeed implements MarketFeed {
  readonly name = "bybit_rest";
  readonly symbol = "BTCUSDT";
  private interval: ReturnType<typeof setInterval> | null = null;
  private handlers = new Set<(tick: MarketTick) => void>();
  private tickSeq = 0;

  start(): void {
    if (this.interval) return;
    const poll = async () => {
      try {
        const res = await fetch(URL, { signal: AbortSignal.timeout(5000) });
        const data = (await res.json()) as {
          result?: { list?: Array<{ lastPrice: string }> };
        };
        const price = Number(data.result?.list?.[0]?.lastPrice);
        if (!price) return;
        this.tickSeq += 1;
        const tick: MarketTick = {
          tickId: `by-${this.tickSeq}-${randomUUID().slice(0, 8)}`,
          symbol: this.symbol,
          price,
          timestamp: Date.now(),
        };
        for (const h of this.handlers) h(tick);
      } catch {
        /* */
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
