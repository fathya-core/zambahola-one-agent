import { randomUUID } from "node:crypto";
import type { MarketTick } from "../types.js";
import type { MarketFeed } from "./types.js";

const URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

/** Fallback when Binance/Bybit geo-blocked — public, no key */
export class CoinGeckoFeed implements MarketFeed {
  readonly name = "coingecko";
  readonly symbol = "BTCUSDT";
  private interval: ReturnType<typeof setInterval> | null = null;
  private handlers = new Set<(tick: MarketTick) => void>();
  private tickSeq = 0;

  start(): void {
    const poll = async () => {
      try {
        const res = await fetch(URL, {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: "application/json" },
        });
        const data = (await res.json()) as { bitcoin?: { usd?: number } };
        const price = data.bitcoin?.usd;
        if (!price) return;
        this.tickSeq += 1;
        const tick: MarketTick = {
          tickId: `cg-${this.tickSeq}-${randomUUID().slice(0, 8)}`,
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
