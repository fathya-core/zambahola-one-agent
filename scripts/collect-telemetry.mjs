#!/usr/bin/env node
/** Collect telemetry from bridge :8790 or agent :8787 directly */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { telemetryTimeFields } from "./time-local.mjs";
import { safeFetchJson, safeFetchOk, finishScript } from "./lib/safe-fetch.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeDir = join(root, "apps/one-agent/data/bridge");
const telemetryFile = join(bridgeDir, "LOCAL-TELEMETRY.json");
const bridgeUrl = process.env.ZAMBAHOLA_BRIDGE_URL ?? "http://127.0.0.1:8790";
const agentUrl = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";

async function fromAgent() {
  const base = agentUrl;
  const status = await safeFetchJson(`${base}/api/status`);
  const metrics = await safeFetchJson(`${base}/api/metrics`);
  const analyst = await safeFetchJson(`${base}/api/analyst`);
  const calibration = await safeFetchJson(`${base}/api/calibration`);
  const learning = await safeFetchJson(`${base}/api/learning`);
  let logAudit = null;
  let skills = null;
  try {
    logAudit = await safeFetchJson(`${base}/api/log-audit`, 8000);
    skills = await safeFetchJson(`${base}/api/skills`, 8000);
  } catch {
    /* older agent builds */
  }

  return {
    ...telemetryTimeFields(),
    hostname: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "local",
    agentUrl,
    status,
    metrics,
    analyst,
    calibration,
    learning: {
      patternInsightsAr: learning?.patternInsightsAr,
      metaLabel: learning?.metaLabel,
      metaPnl: learning?.metaPnl,
      directionalRollingHitRate: learning?.guard?.directionalRollingHitRate,
      logAudits: learning?.logAudits,
    },
    logAudit,
    skillsCatalog: skills?.catalog ?? null,
    analystSkillApplied: analyst?.skillAppliedAr ?? [],
  };
}

export async function refreshTelemetry() {
  try {
    if (await safeFetchOk(`${bridgeUrl}/telemetry`, 12000)) {
      const snap = await safeFetchJson(`${bridgeUrl}/telemetry`, 12000);
      await mkdir(bridgeDir, { recursive: true });
      await writeFile(telemetryFile, JSON.stringify(snap, null, 2), "utf8");
      console.log("[telemetry] refreshed via bridge :8790");
      return true;
    }
  } catch {
    /* fallback to agent */
  }

  try {
    await safeFetchJson(`${agentUrl}/api/status`, 8000);
  } catch {
    console.error("[telemetry] bridge :8790 offline AND agent :8787 unreachable");
    return false;
  }

  const snap = await fromAgent();
  await mkdir(bridgeDir, { recursive: true });
  await writeFile(telemetryFile, JSON.stringify(snap, null, 2), "utf8");
  console.log("[telemetry] refreshed via agent :8787 (bridge offline OK)");
  return true;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("collect-telemetry.mjs");
if (isMain) {
  refreshTelemetry()
    .then((ok) => finishScript(ok ? 0 : 1))
    .catch((err) => {
      console.error("[telemetry] error:", err);
      finishScript(1);
    });
}
