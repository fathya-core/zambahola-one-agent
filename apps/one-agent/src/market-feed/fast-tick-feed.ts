import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { MarketTick } from "../types.js";
import type { MarketFeed } from "./types.js";
import { startDepthPoller } from "./depth-poller.js";

const WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@aggTrade";

/**
 * Sub-second ticks — aggregates aggTrades to ZAMBAHOLA_TICK_MS (default 400ms).
 */
export class FastTickFeed implements MarketFeed {
  readonly name = "fast_tick";
  readonly symbol = "BTCUSDT";
  private ws: WebSocket | null = null;
  private handlers = new Set<(tick: MarketTick) => void>();
  private pendingPrice = 0;
  private pendingQty = 0;
  private pendingTradeMs = 0;
  private lastEmit = 0;
  private tickSeq = 0;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopDepth: (() => void) | null = null;
  private stopped = false;

  constructor(intervalMs = Number(process.env.ZAMBAHOLA_TICK_MS ?? 400)) {
    this.intervalMs = Math.max(200, Math.min(2000, intervalMs));
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Idempotent: tears down any existing connection/timers before reconnecting. */
  private connect(): void {
    if (this.stopped) return;
    this.teardownConnection();

    if (process.env.ZAMBAHOLA_FAST_LOB !== "0") {
      this.stopDepth = startDepthPoller(1500);
    }
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          p?: string;
          q?: string;
          T?: number;
          E?: number;
        };
        if (msg.p) {
          this.pendingPrice = Number(msg.p);
          this.pendingQty += Number(msg.q ?? 0);
          this.pendingTradeMs = Number(msg.T ?? msg.E ?? 0) || 0;
        }
      } catch (err) {
        console.warn(`[zambahola] fast-tick parse failed: ${String(err)}`);
      }
    });
    ws.on("close", () => {
      // Only this socket should schedule a reconnect, and never after stop().
      if (this.ws !== ws || this.stopped) return;
      this.ws = null;
      this.scheduleReconnect();
    });
    ws.on("error", (err) => {
      console.warn(`[zambahola] fast-tick ws error: ${String(err)}`);
    });
    this.timer = setInterval(() => this.emitTick(), this.intervalMs);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  /** Clears timers, depth poller and socket without changing the stopped flag. */
  private teardownConnection(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopDepth?.();
    this.stopDepth = null;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardownConnection();
  }

  onTick(handler: (tick: MarketTick) => void): void {
    this.handlers.add(handler);
  }

  offTick(handler: (tick: MarketTick) => void): void {
    this.handlers.delete(handler);
  }

  private emitTick(): void {
    const price = this.pendingPrice;
    if (!price) return;
    const now = Date.now();
    if (now - this.lastEmit < this.intervalMs * 0.85) return;
    const tradeMs = this.pendingTradeMs > 0 ? this.pendingTradeMs : now;
    // Stale exchange trade time breaks 45s horizon — wall clock at emit (same as binance-ws).
    if (tradeMs > 0 && now - tradeMs > 15_000) return;
    this.lastEmit = now;
    this.tickSeq += 1;
    const tick: MarketTick = {
      tickId: `ft-${this.tickSeq}-${randomUUID().slice(0, 8)}`,
      symbol: this.symbol,
      price,
      volume: this.pendingQty > 0 ? this.pendingQty : undefined,
      timestamp: now,
    };
    this.pendingQty = 0;
    for (const h of this.handlers) h(tick);
  }
}
