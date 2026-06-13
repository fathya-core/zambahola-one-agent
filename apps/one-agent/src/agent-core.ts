import type { MarketFeed } from "./market-feed/index.js";
import { createMarketFeed } from "./market-feed/index.js";
import { startSentimentLoop } from "./sentiment/index.js";
import { startMarketSignalsLoop } from "./market-signals/index.js";
import { PredictionEngine } from "./prediction-engine/index.js";
import { strategyHitsFromVotes } from "./prediction-engine/ensemble.js";
import {
  recordStrategyOutcome,
  appendResearchLog,
} from "./learning/adaptive-weights.js";
import { beginLiveLearningSession, onLiveEvaluation } from "./learning/live-learning.js";
import { maybeSelfHeal } from "./learning/agent-self-guard.js";
import { getMetaLabeler } from "./learning/meta-label.js";
import { getMetaPnlModel } from "./learning/meta-pnl.js";
import { recordPatternEvaluation } from "./learning/pattern-journal.js";
import type { FeatureVector } from "./features/index.js";
import {
  gentleWeightMultipliers,
  shouldPauseMlTrain,
  getGuardStatus,
} from "./learning/hit-rate-guard.js";
import type { LearningState } from "./learning/learning-state.js";
import { DecisionEngine } from "./decision-engine/index.js";
import type { TradeBroker } from "./broker/types.js";
import { createBroker } from "./broker/factory.js";
import { Evaluator } from "./evaluator/index.js";
import { timeSnapshot } from "./lib/time-display.js";
import { isLearnTradeMode } from "./prediction-engine/learn-trade.js";
import {
  getHybridProfile,
  isHybridAuto,
  resolveHorizonSec,
  resolveTradeMaxHoldSec,
} from "./config/hybrid-mode.js";
import { isIntensiveLearn } from "./learning/intensive-learn.js";
import { computeHitBand } from "./learning/hit-eval.js";
import { isRecoveryMode } from "./learning/recovery-mode.js";
import { isHitRecoverMode } from "./learning/hit-recover-mode.js";
import {
  appendRun,
  appendTradeLedger,
  ensureDataDirs,
  resetRunFiles,
  writeMetrics,
  writeReceipt,
} from "./storage/index.js";
import type {
  AgentMetrics,
  AgentStatus,
  MarketTick,
  Prediction,
  Decision,
  StrategyHitStats,
} from "./types.js";

export interface AgentCoreOptions {
  feed?: MarketFeed;
  horizonSec?: number;
  resetData?: boolean;
  broker?: TradeBroker;
}

type TickHandler = (state: AgentRuntimeState) => void;

export interface AgentRuntimeState {
  metrics: AgentMetrics;
  lastTick: MarketTick | null;
  lastPrediction: Prediction | null;
  lastDecision: Decision | null;
}

export class AgentCore {
  readonly feed: MarketFeed;
  readonly predictionEngine: PredictionEngine;
  readonly decisionEngine = new DecisionEngine();
  readonly broker: TradeBroker;
  readonly evaluator = new Evaluator();

  private running = false;
  private tickCount = 0;
  private droppedTicks = 0;
  private predictionCount = 0;
  private startedAt: number | null = null;
  private lastPrice = 0;
  private lastPrediction: Prediction | null = null;
  private lastDecision: Decision | null = null;
  private lastTick: MarketTick | null = null;
  private strategyHits: Record<string, { hits: number; total: number }> = {};
  private hybridSwitchTotal = 0;
  private stopSentiment: (() => void) | null = null;
  private stopMarketSignals: (() => void) | null = null;
  private listeners = new Set<TickHandler>();
  private boundOnTick = (tick: MarketTick) => void this.handleTick(tick);
  private metricsWriteChain: Promise<void> = Promise.resolve();
  private handlingTick = false;
  private learningState: LearningState | null = null;
  private entryTradeContext: {
    features: FeatureVector;
    confidence: number;
    agreement: number;
    regime: string;
  } | null = null;

  constructor(options: AgentCoreOptions = {}) {
    this.broker = options.broker ?? createBroker();
    this.feed = options.feed ?? createMarketFeed();
    this.predictionEngine = new PredictionEngine(
      options.horizonSec != null ? { horizonSec: options.horizonSec } : {},
    );
    this.resetDataOnStart = options.resetData ?? false;
  }

  private resetDataOnStart: boolean;

  onUpdate(handler: TickHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async start(): Promise<void> {
    if (this.running) return;
    await ensureDataDirs();
    if (this.resetDataOnStart) {
      await resetRunFiles();
    }
    this.running = true;
    this.startedAt = Date.now();
    try {
      this.learningState = await beginLiveLearningSession(this.startedAt);
    } catch (err) {
      console.warn("[zambahola] beginLiveLearningSession failed:", err);
    }
    await this.predictionEngine.init();
    const ultraLight = process.env.ZAMBAHOLA_ULTRA_LIGHT === "1";
    if (!ultraLight) {
      this.stopSentiment = startSentimentLoop(90_000);
      this.stopMarketSignals = startMarketSignalsLoop(45_000);
    }
    await writeReceipt("agent-start", {
      symbol: this.feed.symbol,
      feed: this.feed.name,
      horizonSec: this.predictionEngine.horizonSec,
    });
    this.feed.onTick(this.boundOnTick);
    this.feed.start();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.feed.offTick(this.boundOnTick);
    this.feed.stop();
    if (this.stopSentiment) {
      this.stopSentiment();
      this.stopSentiment = null;
    }
    if (this.stopMarketSignals) {
      this.stopMarketSignals();
      this.stopMarketSignals = null;
    }
    this.running = false;
    await writeReceipt("agent-stop", { tickCount: this.tickCount });
    await this.persistMetrics();
  }

  isRunning(): boolean {
    return this.running;
  }

  getStatus(port: number): AgentStatus {
    return {
      running: this.running,
      pid: process.pid,
      symbol: this.feed.symbol,
      feed: this.feed.name,
      brokerMode: this.broker.mode,
      horizonSec: resolveHorizonSec(),
      port,
      startedAt: this.startedAt,
      tickCount: this.tickCount,
      time: timeSnapshot(this.startedAt, this.lastTick?.timestamp ?? null),
      hybridAuto: isHybridAuto(),
      hybridProfile: getHybridProfile(),
      horizonLearnSec: Number(process.env.ZAMBAHOLA_HORIZON_LEARN ?? 25),
      horizonSignalsSec: Number(process.env.ZAMBAHOLA_HORIZON_SIGNALS ?? 45),
    };
  }

  getRuntimeState(): AgentRuntimeState {
    return {
      metrics: this.buildMetrics(),
      lastTick: this.lastTick,
      lastPrediction: this.lastPrediction,
      lastDecision: this.lastDecision,
    };
  }

  private async handleTick(tick: MarketTick): Promise<void> {
    if (this.handlingTick) {
      // Feed produced a tick while the previous one is still processing.
      // Count it so backpressure is visible instead of silently lost.
      this.droppedTicks += 1;
      return;
    }
    this.handlingTick = true;
    try {
      await this.processTick(tick);
    } catch (err) {
      console.error("[zambahola] tick error (agent stays up):", err);
    } finally {
      this.handlingTick = false;
    }
  }

  private async processTick(tick: MarketTick): Promise<void> {
    if (!this.running) return;
    this.tickCount += 1;
    this.lastPrice = tick.price;
    this.lastTick = tick;

    await appendRun({ type: "tick", payload: tick, timestamp: tick.timestamp });

    const prediction = this.predictionEngine.predict(tick);
    this.predictionCount += 1;
    this.lastPrediction = prediction;

    if (prediction.meta?.hybridSwitched) {
      this.hybridSwitchTotal += 1;
    }

    if (
      prediction.meta?.hybridSwitched &&
      prediction.meta.hybridProfile === "signals" &&
      this.broker.getOpenTrade()
    ) {
      const closeDecision = {
        decisionId: `dec-hybrid-switch-${this.tickCount}`,
        tickId: tick.tickId,
        predictionId: prediction.predictionId,
        action: "paper_close" as const,
        reason: "Hybrid switch range→signals — close learn position",
        timestamp: Date.now(),
      };
      const closed = this.broker.execute(closeDecision, tick);
      if (closed) {
        await appendTradeLedger({ event: "trade", trade: closed, decision: closeDecision });
        await appendRun({ type: "trade", payload: closed, timestamp: Date.now() });
      }
    }

    this.evaluator.schedule(prediction);

    await appendRun({
      type: "prediction",
      payload: prediction,
      timestamp: prediction.timestamp,
    });

    const decision = this.decisionEngine.decide(prediction, {
      side: this.broker.getPosition(),
    });
    this.lastDecision = decision;

    await appendRun({
      type: "decision",
      payload: decision,
      timestamp: decision.timestamp,
    });

    let trade = this.broker.execute(decision, tick);
    if (isLearnTradeMode() && !trade) {
      const maxHold = resolveTradeMaxHoldSec(prediction.horizonSec);
      trade = this.broker.forceCloseIfStale(tick, maxHold);
    }
    if (trade) {
      await appendTradeLedger({ event: "trade", trade, decision });
      await appendRun({ type: "trade", payload: trade, timestamp: Date.now() });

      const fv = prediction.meta?.features as FeatureVector | undefined;
      if (trade.status === "open" && fv && prediction.meta?.agreement != null) {
        this.entryTradeContext = {
          features: fv,
          confidence: prediction.confidence,
          agreement: prediction.meta.agreement,
          regime: prediction.meta.regime ?? "range",
        };
      }
      if (trade.status === "closed" && this.entryTradeContext) {
        const metaPnl = await getMetaPnlModel();
        await metaPnl.train(
          this.entryTradeContext.features,
          this.entryTradeContext.confidence,
          this.entryTradeContext.agreement,
          this.entryTradeContext.regime,
          (trade.pnl ?? 0) > 0,
        );
        this.entryTradeContext = null;
      }
    } else if (decision.action !== "no_trade") {
      await appendTradeLedger({ event: "decision", decision });
    }

    this.broker.markToMarket(tick.price);
    const completed = this.evaluator.onPrice(tick.price, Date.now());
    for (const { evaluation, prediction: evaluatedPred } of completed) {
      await appendRun({
        type: "evaluation",
        payload: evaluation,
        timestamp: evaluation.evaluatedAt,
      });
      await writeReceipt(`eval-${evaluation.predictionId.slice(0, 8)}`, evaluation);

      if (evaluatedPred.meta?.strategyVotes) {
        const change = evaluation.priceAtHorizon - evaluation.priceAtPrediction;
        const fv = evaluatedPred.meta?.features as FeatureVector | undefined;
        const band = computeHitBand(
          evaluation.priceAtPrediction,
          fv?.volatility,
        );
        const hits = strategyHitsFromVotes(
          evaluatedPred.meta.strategyVotes,
          evaluation.direction,
          change,
          band,
        );
        const weights = await recordStrategyOutcome(hits, gentleWeightMultipliers());
        this.predictionEngine.setWeights(weights);
        for (const [sid, hit] of Object.entries(hits)) {
          if (!this.strategyHits[sid]) this.strategyHits[sid] = { hits: 0, total: 0 };
          this.strategyHits[sid].total += 1;
          if (hit) this.strategyHits[sid].hits += 1;
        }
        await appendResearchLog({
          event: "strategy_feedback",
          predictionId: evaluation.predictionId,
          ensembleHit: evaluation.predictionHit,
          hits,
          weights,
        });

        if (evaluatedPred.meta?.features && !shouldPauseMlTrain()) {
          await this.predictionEngine.onEvaluationHit(
            evaluatedPred.meta.features,
            evaluation.direction,
            evaluation.predictionHit,
            evaluatedPred.confidence,
          );
        }

        if (fv && evaluatedPred.meta?.agreement != null) {
          const meta = await getMetaLabeler();
          await meta.train(
            fv,
            evaluatedPred.confidence,
            evaluatedPred.meta.agreement,
            evaluation.direction,
            evaluation.predictionHit,
          );
        }

        await recordPatternEvaluation({
          regime: evaluatedPred.meta?.regime ?? "range",
          direction: evaluation.direction,
          ensembleHit: evaluation.predictionHit,
          strategyHits: hits,
          expertReason: evaluatedPred.meta?.expertReason,
          gateReason: evaluatedPred.meta?.gateReason,
        });

        try {
          this.learningState = await onLiveEvaluation({
            ensembleHit: evaluation.predictionHit,
            direction: evaluation.direction,
            directionalHit:
              evaluation.direction !== "range" ? evaluation.predictionHit : null,
            directionalCount: this.evaluator.getDirectionalCount(),
            regime: evaluatedPred.meta?.regime ?? "range",
            strategyStats: this.buildMetrics().strategyStats ?? [],
            engine: this.predictionEngine,
          });
        } catch (err) {
          console.warn("[zambahola] onLiveEvaluation error (tick continues):", err);
        }
      }
    }

    maybeSelfHeal({
      tickCount: this.tickCount,
      startedAt: this.startedAt,
      metrics: this.buildMetrics(),
      engine: this.predictionEngine,
    });

    await this.persistMetrics();

    const state = this.getRuntimeState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private buildMetrics(): AgentMetrics {
    const closed = this.broker.getClosedTrades();
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
    const losses = closed.filter((t) => (t.pnl ?? 0) < 0);
    const avgWin =
      wins.length > 0
        ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length
        : 0;
    const avgLoss =
      losses.length > 0
        ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length
        : 0;

    const weights = this.predictionEngine.getWeights();
    const strategyStats: StrategyHitStats[] = Object.entries(this.strategyHits).map(
      ([strategyId, s]) => ({
        strategyId,
        hits: s.hits,
        total: s.total,
        hitRate: s.total > 0 ? Number((s.hits / s.total).toFixed(4)) : 0,
        weight: weights[strategyId] ?? 1,
      }),
    );

    return {
      tickCount: this.tickCount,
      droppedTicks: this.droppedTicks,
      predictionCount: this.predictionCount,
      hitRate: this.evaluator.getHitRate(),
      directionalHitRate: this.evaluator.getDirectionalHitRate(),
      directionalCount: this.evaluator.getDirectionalCount(),
      abstainRate: this.evaluator.getAbstainRate(),
      paperPnl: this.broker.getTotalPnl(),
      averageWin: Number(avgWin.toFixed(4)),
      averageLoss: Number(avgLoss.toFixed(4)),
      falsePositiveRate: this.evaluator.getFalsePositiveRate(),
      confidenceCalibration: this.evaluator.getConfidenceCalibration(),
      maxDrawdown: this.broker.getMaxDrawdown(),
      openPosition: this.broker.getPosition(),
      lastPrice: this.lastPrice,
      lastPrediction: this.lastPrediction,
      lastDecision: this.lastDecision,
      strategyStats,
      ensembleAgreement: this.lastPrediction?.meta?.agreement,
      feedName: this.feed.name,
      regime: this.lastPrediction?.meta?.regime,
      sentimentScore: this.lastPrediction?.meta?.sentiment,
      mlSamples: this.lastPrediction?.meta?.mlSamples,
      mlpSamples: this.lastPrediction?.meta?.mlpSamples,
      gbmSamples: this.lastPrediction?.meta?.gbmSamples,
      understandingScore: this.learningState?.understandingScore,
      learningUpdates: this.learningState?.totalLearningUpdates,
      liveEvaluations: this.learningState?.totalEvaluations,
      sessionEvaluations: this.learningState?.sessionEvaluations,
      sessionLogAudits: this.learningState?.sessionLogAudits,
      sessionSkillApplies: this.learningState?.sessionSkillApplies,
      rollingHitRate: getGuardStatus().rollingHitRate,
      directionalRollingHitRate: getGuardStatus().directionalRollingHitRate,
      peakHitRate: getGuardStatus().sessionPeak,
      stabilizeMode: getGuardStatus().stabilizeMode,
      paperTradeCount: this.broker.getAllTrades().length,
      closedTradeCount: this.broker.getClosedTrades().length,
      learnTradeMode: isLearnTradeMode(),
      hybridAuto: isHybridAuto(),
      hybridProfile: getHybridProfile(),
      hybridSwitchCount: this.hybridSwitchTotal,
      intensiveLearn: isIntensiveLearn(),
      recoveryMode: isRecoveryMode(),
      hitRecoverMode: isHitRecoverMode(),
      updatedAt: Date.now(),
    };
  }

  private async persistMetrics(): Promise<void> {
    const metrics = this.buildMetrics();
    this.metricsWriteChain = this.metricsWriteChain
      .then(() => writeMetrics(metrics))
      .catch(() => undefined);
    await this.metricsWriteChain;
    await appendRun({
      type: "metric",
      payload: metrics,
      timestamp: metrics.updatedAt,
    });
  }
}
