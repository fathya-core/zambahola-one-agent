import type { MarketTick } from "../types.js";

export interface MarketFeed {
  readonly name: string;
  readonly symbol: string;
  start(): void;
  stop(): void;
  onTick(handler: (tick: MarketTick) => void): void;
  offTick(handler: (tick: MarketTick) => void): void;
}
