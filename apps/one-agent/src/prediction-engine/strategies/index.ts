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
import { longShortExtremeStrategy } from "./long-short-extreme.js";
import { atrBreakoutStrategy } from "./atr-breakout.js";
import { vwapProxyStrategy } from "./vwap-proxy.js";
import { premiumMomentumStrategy } from "./premium-momentum.js";
import { openInterestStrategy } from "./open-interest.js";
import { sessionBiasStrategy } from "./session-bias.js";
import { tickMomentumStrategy } from "./tick-momentum.js";
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
  longShortExtremeStrategy,
  atrBreakoutStrategy,
  vwapProxyStrategy,
  premiumMomentumStrategy,
  openInterestStrategy,
  sessionBiasStrategy,
  tickMomentumStrategy,
];

export const STRATEGY_COUNT = ALL_STRATEGIES.length;

export type { PredictionStrategy, StrategySignal, StrategyContext } from "./types.js";
