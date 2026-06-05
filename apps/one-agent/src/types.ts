export type PredictionDirection = "up" | "down" | "range";
export type DecisionAction =
  | "paper_long"
  | "paper_short"
  | "no_trade"
  | "paper_close";

export interface MarketTick {
  tickId: string;
  symbol: string;
  price: number;
  timestamp: number;
}

export interface StrategyVoteMeta {
  strategyId: string;
  direction: PredictionDirection;
  confidence: number;
  reason: string;
}

export interface PredictionMeta {
  engine: string;
  strategyCount?: number;
  agreement: number;
  strategyVotes: StrategyVoteMeta[];
  weights: Record<string, number>;
  regime?: string;
  gateReason?: string;
  mlScore?: number;
  mlProb?: number;
  mlSamples?: number;
  mlpScore?: number;
  mlpProb?: number;
  mlpSamples?: number;
  gbmScore?: number;
  gbmProb?: number;
  gbmSamples?: number;
  lobScore?: number;
  lobReady?: boolean;
  sentiment?: number;
  sentimentLabel?: string;
  features?: Record<string, number>;
}

export interface Prediction {
  predictionId: string;
  tickId: string;
  symbol: string;
  direction: PredictionDirection;
  confidence: number;
  horizonSec: number;
  priceAtPrediction: number;
  timestamp: number;
  meta?: PredictionMeta;
}

export interface Decision {
  decisionId: string;
  tickId: string;
  predictionId: string;
  action: DecisionAction;
  reason: string;
  timestamp: number;
}

export interface PaperTrade {
  tradeId: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice?: number;
  entryTime: number;
  exitTime?: number;
  pnl?: number;
  status: "open" | "closed";
  tickId: string;
  decisionId: string;
}

export interface PredictionEvaluation {
  evaluationId: string;
  predictionId: string;
  tickId: string;
  direction: PredictionDirection;
  priceAtPrediction: number;
  priceAtHorizon: number;
  horizonSec: number;
  predictionHit: boolean;
  evaluatedAt: number;
}

export interface StrategyHitStats {
  strategyId: string;
  hits: number;
  total: number;
  hitRate: number;
  weight: number;
}

export interface AgentMetrics {
  tickCount: number;
  predictionCount: number;
  hitRate: number;
  paperPnl: number;
  averageWin: number;
  averageLoss: number;
  falsePositiveRate: number;
  confidenceCalibration: number;
  maxDrawdown: number;
  openPosition: "long" | "short" | null;
  lastPrice: number;
  lastPrediction: Prediction | null;
  lastDecision: Decision | null;
  strategyStats?: StrategyHitStats[];
  ensembleAgreement?: number;
  feedName?: string;
  regime?: string;
  sentimentScore?: number;
  mlSamples?: number;
  mlpSamples?: number;
  gbmSamples?: number;
  understandingScore?: number;
  learningUpdates?: number;
  liveEvaluations?: number;
  updatedAt: number;
}

export interface RunRecord {
  type:
    | "tick"
    | "prediction"
    | "decision"
    | "trade"
    | "evaluation"
    | "metric"
    | "receipt";
  payload: unknown;
  timestamp: number;
}

export interface AgentStatus {
  running: boolean;
  pid: number | null;
  symbol: string;
  feed: string;
  horizonSec: number;
  port: number;
  startedAt: number | null;
  tickCount: number;
}
