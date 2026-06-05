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
import { getLiveLearningState } from "../learning/live-learning.js";
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
    return sendJson(res, 200, {
      ...state,
      persistsToDisk: true,
      files: {
        strategyWeights: WEIGHTS_FILE,
        learningState: "data/learning/learning-state.json",
        researchLog: "knowledge/research-log.jsonl",
        modelBundle: "data/learning/export/",
      },
      hasSavedWeights: learningFilesExist(),
      howItWorks: [
        "Each evaluated prediction trains ML/MLP/GBM online",
        "Strategy weights adjust on every hit/miss",
        `Every ${process.env.ZAMBAHOLA_LIVE_ORCH_EVERY ?? 12} evals: orchestrator boosts top strategies`,
        `Every ${process.env.ZAMBAHOLA_LIVE_EXPORT_EVERY ?? 40} evals: model bundle export`,
      ],
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
