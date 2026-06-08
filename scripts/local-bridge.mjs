#!/usr/bin/env node
/**
 * Local Bridge — exposes ZAMBAHOLA agent to Cursor Cloud / remote assistants.
 * Run on your Windows PC alongside agent:phase2-live (dashboard :8787).
 *
 * Endpoints (default :8790):
 *   GET  /health
 *   GET  /telemetry
 *   GET  /proxy/*  → forwards to agent dashboard :8787
 *   POST /command  → queue remote command (written to data/bridge/commands.json)
 */
import { createServer } from "node:http";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { telemetryTimeFields } from "./time-local.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeDir = join(root, "apps/one-agent/data/bridge");
const telemetryFile = join(bridgeDir, "LOCAL-TELEMETRY.json");
const commandsFile = join(bridgeDir, "REMOTE-COMMANDS.json");
const agentBase = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";
const port = Number(process.env.ZAMBAHOLA_BRIDGE_PORT ?? 8790);
const token = process.env.ZAMBAHOLA_BRIDGE_TOKEN ?? "";

async function fetchAgent(path) {
  const res = await fetch(`${agentBase}${path}`, {
    signal: AbortSignal.timeout(8000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function collectTelemetry() {
  const [status, metrics, analyst, calibration, learning, logAudit, skills] = await Promise.all([
    fetchAgent("/api/status"),
    fetchAgent("/api/metrics"),
    fetchAgent("/api/analyst"),
    fetchAgent("/api/calibration"),
    fetchAgent("/api/learning"),
    fetchAgent("/api/log-audit"),
    fetchAgent("/api/skills"),
  ]);
  const snapshot = {
    ...telemetryTimeFields(),
    hostname: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "local",
    agentUrl: agentBase,
    status: status.body,
    metrics: metrics.body,
    analyst: analyst.body,
    calibration: calibration.body,
    learning: {
      patternInsightsAr: learning.body?.patternInsightsAr,
      metaLabel: learning.body?.metaLabel,
      metaPnl: learning.body?.metaPnl,
      directionalRollingHitRate: learning.body?.guard?.directionalRollingHitRate,
      logAudits: learning.body?.logAudits,
      dualAgent: learning.body?.dualAgent,
      sessionEvaluations: learning.body?.sessionEvaluations,
      skillAppliedAr: learning.body?.skillAppliedAr,
    },
    logAudit: logAudit.body?.report ?? logAudit.body,
    dualAgent: logAudit.body?.dualAgent ?? learning.body?.dualAgent ?? null,
    skillsCatalog: skills.body?.catalog ?? null,
    analystSkillApplied: analyst.body?.skillAppliedAr ?? [],
  };
  await mkdir(bridgeDir, { recursive: true });
  await writeFile(telemetryFile, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

function checkAuth(req) {
  if (!token) return true;
  const h = req.headers.authorization ?? "";
  return h === `Bearer ${token}` || h === token;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (!checkAuth(req) && url.pathname !== "/health") {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized — set ZAMBAHOLA_BRIDGE_TOKEN" }));
    return;
  }

  try {
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, bridge: port, agent: agentBase }));
      return;
    }

    if (url.pathname === "/telemetry" && req.method === "GET") {
      const snap = await collectTelemetry();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(snap));
      return;
    }

    if (url.pathname === "/command" && req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const cmd = {
        id: `cmd-${Date.now()}`,
        ts: new Date().toISOString(),
        action: body.action ?? "noop",
        payload: body.payload ?? {},
        source: body.source ?? "remote",
      };
      await mkdir(bridgeDir, { recursive: true });
      let existing = [];
      if (existsSync(commandsFile)) {
        existing = JSON.parse(await readFile(commandsFile, "utf8"));
      }
      existing.push(cmd);
      await writeFile(commandsFile, JSON.stringify(existing.slice(-50), null, 2), "utf8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ queued: cmd }));
      return;
    }

    if (url.pathname.startsWith("/proxy/")) {
      const agentPath = url.pathname.replace("/proxy", "") + (url.search || "");
      const r = await fetch(`${agentBase}${agentPath}`, {
        signal: AbortSignal.timeout(8000),
      });
      const text = await r.text();
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(text);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

const intervalSec = Number(process.env.ZAMBAHOLA_BRIDGE_PUSH_SEC ?? 60);

server.listen(port, "127.0.0.1", () => {
  console.log(`[bridge] ZAMBAHOLA local bridge http://127.0.0.1:${port}`);
  console.log(`[bridge] agent → ${agentBase}`);
  console.log(`[bridge] telemetry → ${telemetryFile}`);
  if (token) console.log("[bridge] token auth ON");
  else console.log("[bridge] WARNING: no ZAMBAHOLA_BRIDGE_TOKEN — local only");
});

void collectTelemetry();
setInterval(() => void collectTelemetry(), intervalSec * 1000);
