#!/usr/bin/env node
/**
 * Full stack health check — local bridge, agent, internet, telemetry, git remote.
 * Run: npm run agent:health-check
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const bridgeUrl = process.env.ZAMBAHOLA_BRIDGE_URL ?? "http://127.0.0.1:8790";
const agentUrl = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";
const telemetryFile = join(root, "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json");

const checks = [];
let failed = 0;

function pass(name, detail) {
  checks.push({ ok: true, name, detail });
  console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail) {
  failed++;
  checks.push({ ok: false, name, detail });
  console.log(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
}

function warn(name, detail) {
  checks.push({ ok: true, warn: true, name, detail });
  console.log(`⚠️  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function pingUrl(label, url, expect = 200) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.status === expect || (expect === "any" && res.status < 500)) {
      pass(`internet:${label}`, `HTTP ${res.status}`);
      return true;
    }
    warn(`internet:${label}`, `HTTP ${res.status} (may be geo-blocked from this network)`);
    return false;
  } catch (e) {
    fail(`internet:${label}`, e.message);
    return false;
  }
}

async function fetchJson(base, path) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log("=== ZAMBAHOLA Health Check ===\n");

  await pingUrl("github", "https://github.com");
  await pingUrl("huggingface", "https://huggingface.co");
  await pingUrl("binance", "https://api.binance.com/api/v3/ping", "any");
  await pingUrl("bybit", "https://api.bybit.com/v5/market/time", "any");

  try {
    const health = await fetchJson(bridgeUrl, "/health");
    pass("bridge", `${bridgeUrl} → agent ${health.agent ?? "?"}`);
  } catch (e) {
    fail("bridge", `${bridgeUrl} — ${e.message}`);
  }

  try {
    const status = await fetchJson(agentUrl, "/api/status");
    const ok = status.running === true;
    if (ok) {
      pass("agent", `feed=${status.feed} horizon=${status.horizonSec}s ticks=${status.tickCount}`);
      if (status.horizonSec !== 45) {
        warn("agent:horizon", `expected 45s, got ${status.horizonSec}s — stop agent then: npm run agent:phase2-live`);
      }
      if (status.feed === "mock") {
        warn("agent:feed", "mock feed — use agent:phase2-live on a real PC");
      } else if (status.feed === "fast_tick") {
        pass("agent:feed", "fast_tick (live ticks via Binance/Bybit — OK for phase2)");
      }
    } else fail("agent", "not running");
  } catch (e) {
    fail("agent", `${agentUrl} — ${e.message}`);
  }

  for (const ep of ["/api/metrics", "/api/analyst", "/api/calibration", "/api/learning"]) {
    try {
      await fetchJson(agentUrl, ep);
      pass(`api${ep}`, "OK");
    } catch (e) {
      fail(`api${ep}`, e.message);
    }
  }

  if (existsSync(telemetryFile)) {
    const ageSec = Math.round((Date.now() - statSync(telemetryFile).mtimeMs) / 1000);
    const raw = JSON.parse(readFileSync(telemetryFile, "utf8"));
    pass("telemetry:file", `age ${ageSec}s hostname=${raw.hostname ?? "?"}`);
    if (raw.hostname === "cursor") warn("telemetry:source", "cloud VM snapshot — not your Windows PC yet");
    if (ageSec > 600) warn("telemetry:stale", "older than 10 min — run bridge + push-telemetry");
  } else {
    fail("telemetry:file", "missing — start agent:local-bridge");
  }

  const ngrok = spawnSync("ngrok", ["version"], { encoding: "utf8", shell: true });
  if (ngrok.status === 0) pass("ngrok", (ngrok.stdout || "").trim().split("\n")[0]);
  else warn("ngrok", "not installed — optional; git telemetry works without it");

  const remote = spawnSync("git", ["remote", "-v"], { cwd: root, encoding: "utf8" });
  if (remote.status === 0 && remote.stdout.includes("origin")) pass("git:remote", "origin configured");
  else fail("git:remote", "no origin remote");

  const mcp = spawnSync("node", [join(root, "mcp-servers/zambahola-local/server.mjs")], {
    input: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hc","version":"1"}}}\n',
    encoding: "utf8",
    timeout: 3000,
    env: { ...process.env, ZAMBAHOLA_BRIDGE_URL: bridgeUrl, ZAMBAHOLA_AGENT_URL: agentUrl },
  });
  if (mcp.stdout?.includes("zambahola-local")) pass("mcp:server", "zambahola-local OK");
  else warn("mcp:server", "stdio handshake inconclusive");

  console.log(`\n=== ${failed ? `${failed} failed` : "All critical checks passed"} ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
