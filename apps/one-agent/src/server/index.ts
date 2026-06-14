import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentCore } from "../agent-core.js";
import { readMetrics } from "../storage/index.js";
import { CURRENT_METRICS_FILE, PAPER_LEDGER_FILE } from "../storage/paths.js";
import { DASHBOARD_PORT } from "../storage/paths.js";
import { loadKnowledgeIndex } from "../../knowledge/loader.js";
import { getSentiment } from "../sentiment/index.js";
import { getOrderBook } from "../market-feed/orderbook.js";
import { getMarketSignals } from "../market-signals/index.js";
import { buildDualAgentStatus, getLiveLearningState } from "../learning/live-learning.js";
import { getGuardStatus } from "../learning/hit-rate-guard.js";
import { loadBestWeights } from "../learning/weight-snapshot.js";
import { getBrokerPhase } from "../broker/factory.js";
import { learningFilesExist } from "../learning/learning-state.js";
import { WEIGHTS_FILE } from "../learning/adaptive-weights.js";

const dashboardDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../dashboard",
);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function createAgentServer(agent: AgentCore, port = DASHBOARD_PORT) {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res, agent);
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  });

  return {
    server,
    port,
    listen: () =>
      new Promise<void>((resolve) => {
        server.listen(port, "127.0.0.1", () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  agent: AgentCore,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1`);
  const path = url.pathname;

  if (path === "/api/status") {
    return sendJson(res, 200, agent.getStatus(DASHBOARD_PORT));
  }
  if (path === "/api/broker") {
    const phase = getBrokerPhase();
    return sendJson(res, 200, {
      mode: agent.broker.mode,
      phase,
      keysConfigured: Boolean(process.env.BINANCE_API_KEY),
      testnet: process.env.ZAMBAHOLA_BINANCE_TESTNET !== "0",
      orderQty: process.env.ZAMBAHOLA_ORDER_QTY ?? "0.001",
    });
  }
  if (path === "/api/metrics") {
    const metrics = (await readMetrics()) ?? agent.getRuntimeState().metrics;
    return sendJson(res, 200, metrics);
  }
  if (path === "/api/prediction/latest") {
    const { lastPrediction } = agent.getRuntimeState();
    return sendJson(res, 200, lastPrediction ?? {});
  }
  if (path === "/api/trades") {
    return sendJson(res, 200, {
      open: agent.broker.getOpenTrade(),
      closed: agent.broker.getClosedTrades(),
      ledgerPath: PAPER_LEDGER_FILE,
    });
  }
  if (path === "/api/evaluations") {
    return sendJson(res, 200, agent.evaluator.getEvaluations());
  }
  if (path === "/api/signals") {
    return sendJson(res, 200, getMarketSignals());
  }
  if (path === "/api/orderbook") {
    return sendJson(res, 200, getOrderBook() ?? {});
  }
  if (path === "/api/sentiment") {
    return sendJson(res, 200, getSentiment());
  }
  if (path === "/api/knowledge") {
    return sendJson(res, 200, await loadKnowledgeIndex());
  }
  if (path === "/api/learning") {
    const state = await getLiveLearningState();
    const guard = getGuardStatus();
    const metrics = agent.getRuntimeState().metrics;
    const best = await loadBestWeights();
    const { getPatternJournal } = await import("../learning/pattern-journal.js");
    const { getMetaLabeler } = await import("../learning/meta-label.js");
    const { getMetaPnlModel } = await import("../learning/meta-pnl.js");
    const patterns = await getPatternJournal();
    const meta = await getMetaLabeler();
    const metaPnl = await getMetaPnlModel();
    const cal = agent.predictionEngine.calibrator;
    const { loadPersistedSkillActions } = await import("../learning/analyst-skill-apply.js");
    const { getLiveLogAuditReport } = await import("../learning/log-audit-hook.js");
    const { getLastLogAuditReport } = await import("../learning/log-auditor.js");
    const audit = getLiveLogAuditReport() ?? (await getLastLogAuditReport());
    const skillApplied = await loadPersistedSkillActions();
    const { loadDlLiveAutoState } = await import("../learning/dl-live-auto.js");
    const dlLiveAuto = await loadDlLiveAutoState();
    return sendJson(res, 200, {
      ...state,
      dlLiveAuto,
      phase5: process.env.ZAMBAHOLA_PHASE5 === "1",
      dualAgent: buildDualAgentStatus(state, {
        directionalRolling: guard.directionalRollingHitRate,
        abstainRate: metrics.abstainRate,
      }),
      skillAppliedAr: skillApplied.map((a) => `${a.status === "applied" ? "✅" : a.status === "queued" ? "📋" : "🚀"} ${a.id}: ${a.detailAr}`),
      logAuditSummary: audit?.summary ?? null,
      guard,
      bestSnapshot: best?.meta ?? null,
      patternInsightsAr: patterns.recentInsightsAr,
      patternJournal: patterns,
      metaLabel: meta.getState(),
      metaPnl: metaPnl.getState(),
      calibration: {
        score: cal.getCalibrationScore(),
        miscalibration: cal.getMiscalibration(),
        samples: cal.getTotalSamples(),
        curve: cal.getReliabilityCurve(),
      },
      persistsToDisk: true,
      files: {
        strategyWeights: WEIGHTS_FILE,
        learningState: "data/learning/learning-state.json",
        researchLog: "knowledge/research-log.jsonl",
        patternJournal: "data/learning/pattern-journal.md",
        metaLabel: "data/learning/meta-label-weights.json",
        metaPnl: "data/learning/meta-pnl-weights.json",
        experiments: "data/learning/experiments/",
        modelBundle: "data/learning/export/",
      },
      hasSavedWeights: learningFilesExist(),
      howItWorks: [
        "Each evaluated prediction trains ML/MLP/GBM + meta-label + meta-PnL online",
        "Micro gates: spread/vol/imbalance + main prob ≥ 0.58",
        "Pattern journal: regime × strategy × gate (Arabic insights)",
        "Strategy weights adjust on every hit/miss",
        `Every ${process.env.ZAMBAHOLA_LIVE_ORCH_EVERY ?? 12} evals: orchestrator boosts top strategies`,
        `Every ${process.env.ZAMBAHOLA_LIVE_EXPORT_EVERY ?? 40} evals: model bundle export`,
        `Every ${process.env.ZAMBAHOLA_LOG_AUDIT_EVERY ?? 50} evals: log reviewer (second agent) audits latest.jsonl`,
      ],
    });
  }
  if (path === "/api/patterns") {
    const { getPatternJournal } = await import("../learning/pattern-journal.js");
    return sendJson(res, 200, await getPatternJournal());
  }
  if (path === "/api/log-audit" && req.method === "GET") {
    const { getLastLogAuditReport } = await import("../learning/log-auditor.js");
    const { getLiveLogAuditReport } = await import("../learning/log-audit-hook.js");
    const state = await getLiveLearningState();
    const cached = getLiveLogAuditReport() ?? (await getLastLogAuditReport());
    return sendJson(res, 200, {
      report: cached ?? { note: "no audit yet — wait for session evaluations" },
      dualAgent: buildDualAgentStatus(state, {
        directionalRolling: getGuardStatus().directionalRollingHitRate,
        abstainRate: agent.getRuntimeState().metrics.abstainRate,
      }),
    });
  }
  if (path === "/api/log-audit" && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
      apply?: boolean;
    };
    const { runLogAudit } = await import("../learning/log-auditor.js");
    const { loadStrategyWeights } = await import("../learning/adaptive-weights.js");
    const report = await runLogAudit({ dryRun: !body.apply });
    if (report.weightsChanged && body.apply) {
      const { ALL_STRATEGIES } = await import("../prediction-engine/strategies/index.js");
      const weights = await loadStrategyWeights(ALL_STRATEGIES.map((s) => s.id));
      agent.predictionEngine.setWeights(weights);
    }
    if (body.apply && report.mlReset) await agent.predictionEngine.ml.load();
    if (body.apply && report.mlpReset) await agent.predictionEngine.mlp.load();
    return sendJson(res, 200, report);
  }
  if (path === "/api/skills") {
    const { getSkillsCatalogSummary, suggestSkillsForContext } = await import(
      "../learning/skills-router.js"
    );
    const q = url.searchParams.get("q") ?? "";
    return sendJson(res, 200, {
      catalog: await getSkillsCatalogSummary(),
      suggestions: q ? suggestSkillsForContext(q) : [],
    });
  }
  if (path === "/api/calibration") {
    const cal = agent.predictionEngine.calibrator;
    return sendJson(res, 200, {
      score: cal.getCalibrationScore(),
      miscalibration: cal.getMiscalibration(),
      samples: cal.getTotalSamples(),
      curve: cal.getReliabilityCurve(),
    });
  }
  if (path === "/api/analyst") {
    const { getPatternJournal } = await import("../learning/pattern-journal.js");
    const { buildAnalystReportAr } = await import("../learning/analyst-ar.js");
    const { getMetaPnlModel } = await import("../learning/meta-pnl.js");
    const { lastPrediction } = agent.getRuntimeState();
    const patterns = await getPatternJournal();
    const metaPnl = await getMetaPnlModel();
    const { getLiveLogAuditReport } = await import("../learning/log-audit-hook.js");
    const { getLastLogAuditReport } = await import("../learning/log-auditor.js");
    const {
      loadPersistedSkillActions,
      applyAnalystSkillActions,
      formatAppliedActionsAr,
    } = await import("../learning/analyst-skill-apply.js");
    const guard = getGuardStatus();
    const audit = getLiveLogAuditReport() ?? (await getLastLogAuditReport());
    const metrics = agent.getRuntimeState().metrics;

    if (req.method === "POST" || url.searchParams.get("apply") === "1") {
      await applyAnalystSkillActions({
        engine: agent.predictionEngine,
        report: audit,
        regime: lastPrediction?.meta?.regime,
        directionalRolling: guard.directionalRollingHitRate,
        abstainRate: metrics.abstainRate,
        force: true,
      });
    }

    const state = await getLiveLearningState();
    const applied = await loadPersistedSkillActions();
    const report = buildAnalystReportAr(
      lastPrediction?.meta,
      patterns,
      audit?.insightsAr,
      formatAppliedActionsAr(applied),
    );
    return sendJson(res, 200, {
      ...report,
      skillAppliedAr: formatAppliedActionsAr(applied),
      autoApplyEnabled: process.env.ZAMBAHOLA_ANALYST_AUTO_APPLY !== "0",
      dualAgent: buildDualAgentStatus(state, {
        directionalRolling: guard.directionalRollingHitRate,
        abstainRate: metrics.abstainRate,
      }),
      logAuditSummary: audit?.summary ?? null,
      metaPnl: metaPnl.getState(),
      lastPrediction: lastPrediction
        ? {
            direction: lastPrediction.direction,
            confidence: lastPrediction.confidence,
            analystSummaryAr: lastPrediction.meta?.analystSummaryAr,
            gateReason: lastPrediction.meta?.gateReason,
          }
        : null,
    });
  }
  if (path === "/api/strategies") {
    const idx = (await loadKnowledgeIndex()) as { strategies: unknown[] };
    const weights = agent.predictionEngine.getWeights();
    const stats = agent.getRuntimeState().metrics.strategyStats ?? [];
    return sendJson(res, 200, { strategies: idx.strategies, weights, stats });
  }

  if (path === "/" || path.startsWith("/dashboard")) {
    const filePath =
      path === "/"
        ? join(dashboardDir, "index.html")
        : join(dashboardDir, path.replace("/dashboard/", ""));
    if (existsSync(filePath)) {
      const ext = extname(filePath);
      const body = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] ?? "text/plain" });
      res.end(body);
      return;
    }
  }

  sendJson(res, 404, { error: "Not found" });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

export { DASHBOARD_PORT, CURRENT_METRICS_FILE };
