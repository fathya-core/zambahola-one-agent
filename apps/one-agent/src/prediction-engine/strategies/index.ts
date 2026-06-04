import { momentumStrategy } from "./momentum.js";
import { meanReversionStrategy } from "./mean-reversion.js";
import { rsiStrategy } from "./rsi.js";
import { emaCrossStrategy } from "./ema-cross.js";
import { volatilityRegimeStrategy } from "./volatility-regime.js";
import { bollingerStrategy } from "./bollinger.js";
import type { PredictionStrategy } from "./types.js";

export const ALL_STRATEGIES: PredictionStrategy[] = [
  momentumStrategy,
  meanReversionStrategy,
  rsiStrategy,
  emaCrossStrategy,
  volatilityRegimeStrategy,
  bollingerStrategy,
];

export type { PredictionStrategy, StrategySignal, StrategyContext } from "./types.js";
