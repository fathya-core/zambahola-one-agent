#!/usr/bin/env node
/** Collect telemetry from bridge :8790 or agent :8787 directly */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeDir = join(root, "apps/one-agent/data/bridge");
const telemetryFile = join(bridgeDir, "LOCAL-TELEMETRY.json");
const bridgeUrl = process.env.ZAMBAHOLA_BRIDGE_URL ?? "http://127.0.0.1:8790";
const agentUrl = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";

async function fetchJson(base, path) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
}

async function fromAgent() {
  const [status, metrics, analyst, calibration, learning] = await Promise.all([
    fetchJson(agentUrl, "/api/status"),
    fetchJson(agentUrl, "/api/metrics"),
    fetchJson(agentUrl, "/api/analyst"),
    fetchJson(agentUrl, "/api/calibration"),
    fetchJson(agentUrl, "/api/learning"),
  ]);
  return {
    ts: new Date().toISOString(),
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
    },
  };
}

export async function refreshTelemetry() {
  try {
    const res = await fetch(`${bridgeUrl}/telemetry`, { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      console.log("[telemetry] refreshed via bridge :8790");
      return true;
    }
  } catch {
    /* fallback */
  }

  if (!await agentReachable()) {
    console.error("[telemetry] bridge :8790 offline AND agent :8787 unreachable");
    return false;
  }

  const snap = await fromAgent();
  await mkdir(bridgeDir, { recursive: true });
  await writeFile(telemetryFile, JSON.stringify(snap, null, 2), "utf8");
  console.log("[telemetry] refreshed via agent :8787 (bridge offline OK)");
  return true;
}

async function agentReachable() {
  try {
    await fetchJson(agentUrl, "/api/status");
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1]?.endsWith("collect-telemetry.mjs")) {
  const ok = await refreshTelemetry();
  process.exit(ok ? 0 : 1);
}
