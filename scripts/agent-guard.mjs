#!/usr/bin/env node
/**
 * Live guard — polls agent :8787, auto-fixes via API/npm, writes GUARD-REPORT.json.
 * Run on OMAR-PC alongside agent (zero cloud latency for fixes).
 *
 *   npm run agent:guard
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diagnoseSnapshot } from "./guard-rules.mjs";
import { refreshTelemetry } from "./collect-telemetry.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeDir = join(root, "apps/one-agent/data/bridge");
const reportFile = join(bridgeDir, "GUARD-REPORT.json");
const agentUrl = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";
const pollSec = Number(process.env.ZAMBAHOLA_GUARD_POLL_SEC ?? 45);
const pushEveryMin = Number(process.env.ZAMBAHOLA_GUARD_PUSH_MIN ?? 8);
const fixCooldownMs = Number(process.env.ZAMBAHOLA_GUARD_FIX_COOLDOWN_MS ?? 300_000);

const lastFixAt = new Map();
let lastPushAt = 0;

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${agentUrl}${path}`, {
    signal: AbortSignal.timeout(12_000),
    ...opts,
  });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
}

async function collectSnap() {
  const [status, metrics, learning, analyst, logAudit] = await Promise.all([
    fetchJson("/api/status"),
    fetchJson("/api/metrics"),
    fetchJson("/api/learning"),
    fetchJson("/api/analyst").catch(() => null),
    fetchJson("/api/log-audit").catch(() => null),
  ]);
  return {
    ts: new Date().toISOString(),
    hostname: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "local",
    status,
    metrics,
    learning,
    analyst,
    logAudit: logAudit?.report ?? logAudit,
    dualAgent: learning?.dualAgent ?? analyst?.dualAgent ?? logAudit?.dualAgent,
  };
}

async function applyApiFix(action) {
  if (action === "analyst-apply") {
    await fetchJson("/api/analyst?apply=1");
    return "api:analyst apply";
  }
  if (action === "log-review:apply") {
    await fetch(`${agentUrl}/api/log-audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply: true }),
      signal: AbortSignal.timeout(60_000),
    });
    return "api:log-audit apply";
  }
  throw new Error(`unknown api fix: ${action}`);
}

function runNpmScript(script) {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const child = spawn(isWin ? "npm.cmd" : "npm", ["run", script], {
      cwd: root,
      stdio: "pipe",
      shell: isWin,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function applyFix(fix) {
  const key = `${fix.via}:${fix.action}`;
  const prev = lastFixAt.get(key) ?? 0;
  if (Date.now() - prev < fixCooldownMs) {
    return { skipped: true, key, reason: "cooldown" };
  }

  try {
    let detail;
    if (fix.via === "api") {
      detail = await applyApiFix(fix.action);
    } else if (fix.via === "npm") {
      const script = fix.action === "phase4-hit-recover" ? "agent:phase4-hit-recover" : `agent:${fix.action}`;
      const code = await runNpmScript(script);
      detail = `npm:${script} exit=${code}`;
      if (code !== 0) return { ok: false, key, detail };
    } else {
      return { skipped: true, key, reason: "unknown via" };
    }
    lastFixAt.set(key, Date.now());
    return { ok: true, key, detail, reason: fix.reason };
  } catch (err) {
    return { ok: false, key, error: String(err) };
  }
}

async function tick() {
  const report = {
    ts: new Date().toISOString(),
    pollSec,
    agentUrl,
    snap: null,
    diagnosis: null,
    applied: [],
    error: null,
  };

  try {
    const snap = await collectSnap();
    report.snap = {
      running: snap.status?.running,
      tickCount: snap.status?.tickCount,
      uptimeSec: snap.status?.time?.uptimeSec,
      abstainRate: snap.metrics?.abstainRate,
      directionalCount: snap.metrics?.directionalCount,
      sessionEvaluations: snap.dualAgent?.sessionEvaluations,
      sessionLogAudits: snap.dualAgent?.sessionLogAudits,
    };
    const diagnosis = diagnoseSnapshot(snap);
    report.diagnosis = diagnosis;

    for (const fix of diagnosis.fixes.slice(0, 3)) {
      const result = await applyFix(fix);
      report.applied.push({ fix, result });
      if (result.ok) {
        console.log(`[guard] fixed: ${result.key} — ${result.detail}`);
      } else if (!result.skipped) {
        console.warn(`[guard] fix failed: ${result.key}`, result.error ?? result.detail);
      }
    }

    if (
      pushEveryMin > 0 &&
      Date.now() - lastPushAt > pushEveryMin * 60_000
    ) {
      await refreshTelemetry();
      lastPushAt = Date.now();
      report.telemetryRefreshed = true;
      console.log("[guard] telemetry refreshed locally");
    }
  } catch (err) {
    report.error = String(err);
    console.warn("[guard] poll error:", err.message);
  }

  await mkdir(bridgeDir, { recursive: true });
  await writeFile(reportFile, JSON.stringify(report, null, 2), "utf8");
  return report;
}

console.log(`[guard] watching ${agentUrl} every ${pollSec}s → ${reportFile}`);
void tick();
setInterval(() => void tick(), pollSec * 1000);
