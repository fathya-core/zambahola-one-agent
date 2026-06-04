import { momentumStrategy } from "./momentum.js";
import { meanReversionStrategy } from "./mean-reversion.js";
import { rsiStrategy } from "./rsi.js";
import { emaCrossStrategy } from "./ema-cross.js";
import { volatilityRegimeStrategy } from "./volatility-regime.js";
import { bollingerStrategy } from "./bollinger.js";
import { macdStrategy } from "./macd.js";
import { orderImbalanceStrategy } from "./order-imbalance.js";
import { fundingFadeStrategy } from "./funding-fade.js";
import { volumeBreakoutStrategy } from "./volume-breakout.js";
import type { PredictionStrategy } from "./types.js";

export const ALL_STRATEGIES: PredictionStrategy[] = [
  momentumStrategy,
  meanReversionStrategy,
  rsiStrategy,
  emaCrossStrategy,
  volatilityRegimeStrategy,
  bollingerStrategy,
  macdStrategy,
  orderImbalanceStrategy,
  fundingFadeStrategy,
  volumeBreakoutStrategy,
];

export type { PredictionStrategy, StrategySignal, StrategyContext } from "./types.js";
