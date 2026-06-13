import { randomUUID } from "node:crypto";
import type { Decision, MarketTick, PaperTrade } from "../types.js";

export class PaperBroker {
  readonly mode = "paper" as const;
  private openTrade: PaperTrade | null = null;
  private closedTrades: PaperTrade[] = [];
  // Live equity peak / max drawdown including unrealized PnL (updated in markToMarket).
  private equityPeak = 0;
  private liveMaxDrawdown = 0;

  getPosition(): "long" | "short" | null {
    return this.openTrade?.side ?? null;
  }

  getOpenTrade(): PaperTrade | null {
    return this.openTrade;
  }

  getClosedTrades(): PaperTrade[] {
    return [...this.closedTrades];
  }

  getAllTrades(): PaperTrade[] {
    return this.openTrade
      ? [...this.closedTrades, this.openTrade]
      : [...this.closedTrades];
  }

  getTotalPnl(): number {
    const closed = this.closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const open = this.openTrade
      ? this.unrealizedPnl(this.openTrade, this.openTrade.entryPrice)
      : 0;
    return Number((closed + open).toFixed(4));
  }

  getMaxDrawdown(): number {
    let maxDd = 0;
    let peak = 0;
    let cum = 0;
    for (const t of this.closedTrades) {
      cum += t.pnl ?? 0;
      peak = Math.max(peak, cum);
      maxDd = Math.max(maxDd, peak - cum);
    }
    // Include intra-trade (unrealized) drawdown tracked by markToMarket.
    return Number(Math.max(maxDd, this.liveMaxDrawdown).toFixed(4));
  }

  execute(decision: Decision, tick: MarketTick): PaperTrade | null {
    switch (decision.action) {
      case "paper_long":
        if (!this.openTrade) {
          this.openTrade = this.open("long", tick, decision);
          return this.openTrade;
        }
        return null;
      case "paper_short":
        if (!this.openTrade) {
          this.openTrade = this.open("short", tick, decision);
          return this.openTrade;
        }
        return null;
      case "paper_close":
        return this.close(tick, decision);
      default:
        return null;
    }
  }

  markToMarket(price: number): void {
    const realized = this.closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const unrealized = this.openTrade ? this.unrealizedPnl(this.openTrade, price) : 0;
    const total = realized + unrealized;
    this.equityPeak = Math.max(this.equityPeak, total);
    this.liveMaxDrawdown = Math.max(this.liveMaxDrawdown, this.equityPeak - total);
  }

  /** Rotate open paper positions so meta-PnL / strategy weights learn faster */
  forceCloseIfStale(tick: MarketTick, maxHoldSec: number): PaperTrade | null {
    if (!this.openTrade || maxHoldSec <= 0) return null;
    if (tick.timestamp - this.openTrade.entryTime < maxHoldSec * 1000) return null;
    const decision = {
      decisionId: `dec-learn-rotate-${this.openTrade.tradeId.slice(0, 8)}`,
      tickId: tick.tickId,
      predictionId: "learn-rotate",
      action: "paper_close" as const,
      reason: `Learn rotate after ${maxHoldSec}s`,
      timestamp: tick.timestamp,
    };
    return this.close(tick, decision);
  }

  private open(
    side: "long" | "short",
    tick: MarketTick,
    decision: Decision,
  ): PaperTrade {
    return {
      tradeId: `trade-${randomUUID()}`,
      side,
      entryPrice: tick.price,
      entryTime: tick.timestamp,
      status: "open",
      tickId: tick.tickId,
      decisionId: decision.decisionId,
    };
  }

  private close(tick: MarketTick, _decision: Decision): PaperTrade | null {
    if (!this.openTrade) return null;
    const trade = this.openTrade;
    trade.exitPrice = tick.price;
    trade.exitTime = tick.timestamp;
    trade.status = "closed";
    trade.pnl = this.unrealizedPnl(trade, tick.price);
    this.closedTrades.push(trade);
    this.openTrade = null;
    return trade;
  }

  private unrealizedPnl(trade: PaperTrade, price: number): number {
    const raw =
      trade.side === "long"
        ? price - trade.entryPrice
        : trade.entryPrice - price;
    return Number(raw.toFixed(4));
  }
}
