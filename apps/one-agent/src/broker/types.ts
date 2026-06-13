import type { Decision, MarketTick, PaperTrade } from "../types.js";

/** Unified broker — paper, demo testnet, or live */
export interface TradeBroker {
  readonly mode: string;
  getPosition(): "long" | "short" | null;
  getOpenTrade(): PaperTrade | null;
  getClosedTrades(): PaperTrade[];
  getAllTrades(): PaperTrade[];
  getTotalPnl(): number;
  getMaxDrawdown(): number;
  execute(decision: Decision, tick: MarketTick): PaperTrade | null;
  markToMarket(price: number): void;
  /** Rotate open positions in learn mode so models learn faster. */
  forceCloseIfStale(tick: MarketTick, maxHoldSec: number): PaperTrade | null;
}

export type BrokerMode = "paper" | "binance_demo" | "binance_live" | "bybit_demo";
