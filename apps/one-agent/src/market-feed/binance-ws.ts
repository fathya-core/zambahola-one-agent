import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { MarketTick } from "../types.js";
import type { MarketFeed } from "./types.js";

const SYMBOL = "BTCUSDT";
const WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@aggTrade";

/**
 * Live Binance aggTrade stream — aggregates to ~1 tick/sec for agent loop.
 */
export class BinanceWsFeed implements MarketFeed {
  readonly name = "binance_ws";
  readonly symbol = SYMBOL;
  private ws: WebSocket | null = null;
  private handlers = new Set<(tick: MarketTick) => void>();
  private lastEmit = 0;
  private lastPrice = 0;
  private tickSeq = 0;
  private emitInterval: ReturnType<typeof setInterval> | null = null;
  private pendingPrice = 0;

  start(): void {
    if (this.ws) return;
    this.connect();
    this.emitInterval = setInterval(() => this.flushTick(), 1000);
  }

  stop(): void {
    if (this.emitInterval) {
      clearInterval(this.emitInterval);
      this.emitInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  onTick(handler: (tick: MarketTick) => void): void {
    this.handlers.add(handler);
  }

  offTick(handler: (tick: MarketTick) => void): void {
    this.handlers.delete(handler);
  }

  private connect(): void {
    this.ws = new WebSocket(WS_URL);

    this.ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { p?: string };
        if (msg.p) this.pendingPrice = Number(msg.p);
      } catch {
        /* */
      }
    });

    this.ws.on("close", () => {
      this.ws = null;
      setTimeout(() => {
        if (this.emitInterval) this.connect();
      }, 3000);
    });

    this.ws.on("error", () => {
      /* reconnect on close */
    });
  }

  private flushTick(): void {
    const price = this.pendingPrice || this.lastPrice;
    if (!price) return;
    const now = Date.now();
    if (now - this.lastEmit < 900) return;
    this.lastEmit = now;
    this.lastPrice = price;
    this.tickSeq += 1;
    const tick: MarketTick = {
      tickId: `bn-${this.tickSeq}-${randomUUID().slice(0, 8)}`,
      symbol: this.symbol,
      price,
      timestamp: now,
    };
    for (const h of this.handlers) h(tick);
  }
}
