import type { MarketFeed } from "./market-feed/index.js";
import { MockMarketFeed } from "./market-feed/index.js";
import { PredictionEngine } from "./prediction-engine/index.js";
import { DecisionEngine } from "./decision-engine/index.js";
import { PaperBroker } from "./paper-broker/index.js";
import { Evaluator } from "./evaluator/index.js";
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
} from "./types.js";

export interface AgentCoreOptions {
  feed?: MarketFeed;
  horizonSec?: number;
  resetData?: boolean;
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
  readonly broker = new PaperBroker();
  readonly evaluator = new Evaluator();

  private running = false;
  private tickCount = 0;
  private predictionCount = 0;
  private startedAt: number | null = null;
  private lastPrice = 0;
  private lastPrediction: Prediction | null = null;
  private lastDecision: Decision | null = null;
  private lastTick: MarketTick | null = null;
  private listeners = new Set<TickHandler>();
  private boundOnTick = (tick: MarketTick) => void this.handleTick(tick);

  constructor(options: AgentCoreOptions = {}) {
    this.feed = options.feed ?? new MockMarketFeed();
    this.predictionEngine = new PredictionEngine({
      horizonSec: options.horizonSec ?? 30,
    });
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
      horizonSec: this.predictionEngine.horizonSec,
      port,
      startedAt: this.startedAt,
      tickCount: this.tickCount,
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
    this.tickCount += 1;
    this.lastPrice = tick.price;
    this.lastTick = tick;

    await appendRun({ type: "tick", payload: tick, timestamp: tick.timestamp });

    const prediction = this.predictionEngine.predict(tick);
    this.predictionCount += 1;
    this.lastPrediction = prediction;
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

    const trade = this.broker.execute(decision, tick);
    if (trade) {
      await appendTradeLedger({ event: "trade", trade, decision });
      await appendRun({ type: "trade", payload: trade, timestamp: Date.now() });
    } else if (decision.action !== "no_trade") {
      await appendTradeLedger({ event: "decision", decision });
    }

    this.broker.markToMarket(tick.price);
    const evaluations = this.evaluator.onPrice(tick.price, tick.timestamp);
    for (const evaluation of evaluations) {
      await appendRun({
        type: "evaluation",
        payload: evaluation,
        timestamp: evaluation.evaluatedAt,
      });
      await writeReceipt(`eval-${evaluation.predictionId.slice(0, 8)}`, evaluation);
    }

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

    return {
      tickCount: this.tickCount,
      predictionCount: this.predictionCount,
      hitRate: this.evaluator.getHitRate(),
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
      updatedAt: Date.now(),
    };
  }

  private async persistMetrics(): Promise<void> {
    const metrics = this.buildMetrics();
    await writeMetrics(metrics);
    await appendRun({
      type: "metric",
      payload: metrics,
      timestamp: metrics.updatedAt,
    });
  }
}
