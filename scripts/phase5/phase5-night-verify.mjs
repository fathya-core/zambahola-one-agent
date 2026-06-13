#!/usr/bin/env node
/** Post-night smoke test — agent up, ticks moving, exports fresh (Windows OMAR-PC) */
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "../core/lib/run-npm.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const liveOnly =
  process.argv.includes("--live-only") || process.env.ZAMBAHOLA_PHASE5_VERIFY_LIVE_ONLY === "1";
const agentUrl = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";
const tz = process.env.ZAMBAHOLA_PHASE5_TZ ?? "Asia/Riyadh";
const reportFile = join(root, "apps/one-agent/data/bridge/PHASE5-NIGHT-VERIFY.json");

function todayKey() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

async function fetchStatus() {
  const res = await fetch(`${agentUrl}/api/status`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`status HTTP ${res.status}`);
  return res.json();
}

async function fetchMetrics() {
  const res = await fetch(`${agentUrl}/api/metrics`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`metrics HTTP ${res.status}`);
  return res.json();
}

function checkExport(name) {
  const p = join(root, "apps/one-agent/data/learning/export", name);
  if (!existsSync(p)) return { ok: false, detail: "missing" };
  const ageH = (Date.now() - statSync(p).mtimeMs) / 3_600_000;
  let exportedAt = null;
  try {
    exportedAt = JSON.parse(readFileSync(p, "utf8")).exportedAt ?? null;
  } catch {
    /* */
  }
  return {
    ok: ageH < 12,
    detail: `ageH=${ageH.toFixed(1)} exportedAt=${exportedAt ?? "?"}`,
    path: p,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const checks = [];
let failed = 0;

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  const mark = ok ? "OK" : "FAIL";
  console.log(`[phase5-verify] ${mark} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}

console.log(
  `[phase5-verify] === ${liveOnly ? "live-now test (no export required)" : "post-night test"} ===\n`,
);

try {
  const s1 = await fetchStatus();
  record("agent_running", s1.running === true, `pid=${s1.pid} feed=${s1.feed}`);
  const t1 = s1.tickCount ?? 0;

  await sleep(5000);

  const s2 = await fetchStatus();
  const t2 = s2.tickCount ?? 0;
  const ticksMoved = t2 > t1;
  record("ticks_moving", ticksMoved, `tickCount ${t1} → ${t2}`);

  const metrics = await fetchMetrics();
  record(
    "metrics_api",
    metrics != null,
    `dirHit=${metrics?.directionalHitRate ?? "?"} preds=${metrics?.predictionCount ?? "?"}`,
  );

  if (liveOnly) {
    record("export_hybrid_v7", true, "skipped (live-now)");
    record("export_hybrid_v7_omni", true, "skipped (live-now)");
    record("night_train_artifacts", true, "skipped — live-now path");
  } else {
    const v7 = checkExport("hybrid_v7-bundle.json");
    record("export_hybrid_v7", v7.ok, v7.detail);

    const omni = checkExport("hybrid_v7_omni-bundle.json");
    record("export_hybrid_v7_omni", omni.ok, omni.detail);

    const trainOk = v7.ok || omni.ok;
    record("night_train_artifacts", trainOk, trainOk ? "at least one fresh bundle" : "no fresh export");
  }
} catch (err) {
  record("agent_reachable", false, String(err));
}

const push = runNpm(["run", "agent:push-telemetry"], { cwd: root, stdio: "pipe" });
record("telemetry_push", push.ok, push.ok ? "ok" : "failed");

const report = {
  ts: new Date().toISOString(),
  dateKey: todayKey(),
  mode: liveOnly ? "live-only" : "post-night",
  ok: failed === 0,
  failed,
  checks,
};
mkdirSync(dirname(reportFile), { recursive: true });
writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf8");

const passMsg = liveOnly
  ? "PASS — الوكيل شغال ويتداول paper (live-now)"
  : "PASS — الليل خلص والوكيل يتداول paper";
console.log(`\n[phase5-verify] ${failed === 0 ? passMsg : `FAIL — ${failed} check(s)`}`);
console.log(`[phase5-verify] report: ${reportFile}\n`);

process.exit(failed === 0 ? 0 : 1);
