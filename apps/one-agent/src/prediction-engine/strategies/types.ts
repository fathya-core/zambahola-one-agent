import type { PredictionDirection } from "../../types.js";

export interface StrategySignal {
  strategyId: string;
  direction: PredictionDirection;
  confidence: number;
  reason: string;
}

export interface StrategyContext {
  prices: number[];
  currentPrice: number;
}

export interface PredictionStrategy {
  readonly id: string;
  readonly name: string;
  evaluate(ctx: StrategyContext): StrategySignal;
}
