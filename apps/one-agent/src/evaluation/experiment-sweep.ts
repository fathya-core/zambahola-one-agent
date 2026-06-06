import { replayKlineEvaluate } from "./kline-replay.js";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = join(pkgRoot, "data", "learning", "experiments");

export interface SweepRow {
  experiment: string;
  param: string;
  value: number | string;
  directionalHitRate: number;
  hitRate: number;
  abstainRate: number;
  directionalCount: number;
}

async function saveReport(rows: SweepRow[], name: string): Promise<string> {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${name}-${Date.now()}.json`);
  await writeFile(path, JSON.stringify({ rows, ts: Date.now() }, null, 2), "utf8");
  return path;
}

function replayEnvForSweep(): Record<string, string | undefined> {
  return {
    ZAMBAHOLA_ACCURACY_FILTER: "off",
    ZAMBAHOLA_LIVE_FILTER: "0",
    ZAMBAHOLA_MICRO_GATES: "0",
    ZAMBAHOLA_META_LABEL: "0",
    ZAMBAHOLA_META_PNL: "0",
    ZAMBAHOLA_EXPERT_RELAX: "1",
    ZAMBAHOLA_EXPERT_MIN_S_VOTES: "1",
    ZAMBAHOLA_MIN_AGREEMENT: "0.48",
    ZAMBAHOLA_MIN_MAIN_PROB: "0.5",
    ZAMBAHOLA_ACCURACY_MODE: "normal",
    ZAMBAHOLA_BLEND_COMBINED: "0.04",
    ZAMBAHOLA_EXPERT: "0",
  };
}

/** Exp 01 — LABEL_BP sweep (2–8 bp) */
export async function experiment01LabelBp(bars = 500): Promise<SweepRow[]> {
  const saved = { ...process.env };
  Object.assign(process.env, replayEnvForSweep());
  const rows: SweepRow[] = [];
  for (const bp of [2, 2.5, 3, 4, 5, 6, 8]) {
    const r = await replayKlineEvaluate({ bars, labelBp: bp });
    rows.push({
      experiment: "01_label_bp",
      param: "ZAMBAHOLA_LABEL_BP",
      value: bp,
      directionalHitRate: r.directionalHitRate,
      hitRate: r.hitRate,
      abstainRate: r.abstainRate,
      directionalCount: r.directionalCount,
    });
    console.log(`[exp01] bp=${bp} dir=${r.directionalHitRate} abstain=${r.abstainRate}`);
  }
  Object.assign(process.env, saved);
  const path = await saveReport(rows, "01-label-bp");
  console.log("[exp01] saved", path);
  return rows;
}

/** Exp 02 — META_THRESHOLD sweep */
export async function experiment02MetaThreshold(bars = 500): Promise<SweepRow[]> {
  const saved = { ...process.env };
  Object.assign(process.env, replayEnvForSweep());
  const prev = process.env.ZAMBAHOLA_META_THRESHOLD;
  const rows: SweepRow[] = [];
  for (const th of [0.45, 0.5, 0.52, 0.55, 0.58, 0.62]) {
    process.env.ZAMBAHOLA_META_THRESHOLD = String(th);
    process.env.ZAMBAHOLA_META_LABEL = "1";
    const r = await replayKlineEvaluate({ bars, labelBp: 2.5 });
    rows.push({
      experiment: "02_meta_threshold",
      param: "ZAMBAHOLA_META_THRESHOLD",
      value: th,
      directionalHitRate: r.directionalHitRate,
      hitRate: r.hitRate,
      abstainRate: r.abstainRate,
      directionalCount: r.directionalCount,
    });
    console.log(`[exp02] meta=${th} dir=${r.directionalHitRate}`);
  }
  if (prev === undefined) delete process.env.ZAMBAHOLA_META_THRESHOLD;
  else process.env.ZAMBAHOLA_META_THRESHOLD = prev;
  Object.assign(process.env, saved);
  const path = await saveReport(rows, "02-meta-threshold");
  console.log("[exp02] saved", path);
  return rows;
}

/** Exp 03 — MIN_AGREEMENT sweep */
export async function experiment03MinAgreement(bars = 500): Promise<SweepRow[]> {
  const saved = { ...process.env };
  Object.assign(process.env, replayEnvForSweep());
  const prev = process.env.ZAMBAHOLA_MIN_AGREEMENT;
  const rows: SweepRow[] = [];
  for (const ag of [0.48, 0.52, 0.55, 0.58, 0.62, 0.65]) {
    process.env.ZAMBAHOLA_MIN_AGREEMENT = String(ag);
    process.env.ZAMBAHOLA_LIVE_FILTER = "1";
    process.env.ZAMBAHOLA_ACCURACY_MODE = "max";
    process.env.ZAMBAHOLA_ACCURACY_FILTER = "live";
    const r = await replayKlineEvaluate({ bars, labelBp: 2.5 });
    rows.push({
      experiment: "03_min_agreement",
      param: "ZAMBAHOLA_MIN_AGREEMENT",
      value: ag,
      directionalHitRate: r.directionalHitRate,
      hitRate: r.hitRate,
      abstainRate: r.abstainRate,
      directionalCount: r.directionalCount,
    });
    console.log(`[exp03] agree=${ag} dir=${r.directionalHitRate} abstain=${r.abstainRate}`);
  }
  if (prev === undefined) delete process.env.ZAMBAHOLA_MIN_AGREEMENT;
  else process.env.ZAMBAHOLA_MIN_AGREEMENT = prev;
  Object.assign(process.env, saved);
  const path = await saveReport(rows, "03-min-agreement");
  console.log("[exp03] saved", path);
  return rows;
}

/** Exp 04 — spread gate max sweep */
export async function experiment04SpreadGate(bars = 500): Promise<SweepRow[]> {
  const saved = { ...process.env };
  Object.assign(process.env, replayEnvForSweep());
  const prev = process.env.ZAMBAHOLA_MAX_SPREAD_BP;
  const rows: SweepRow[] = [];
  for (const sp of [3, 4, 5, 6, 8, 12]) {
    process.env.ZAMBAHOLA_MAX_SPREAD_BP = String(sp);
    process.env.ZAMBAHOLA_MICRO_GATES = "1";
    process.env.ZAMBAHOLA_MIN_MAIN_PROB = "0.52";
    const r = await replayKlineEvaluate({ bars, labelBp: 2.5 });
    rows.push({
      experiment: "04_max_spread_bp",
      param: "ZAMBAHOLA_MAX_SPREAD_BP",
      value: sp,
      directionalHitRate: r.directionalHitRate,
      hitRate: r.hitRate,
      abstainRate: r.abstainRate,
      directionalCount: r.directionalCount,
    });
    console.log(`[exp04] spread=${sp} dir=${r.directionalHitRate}`);
  }
  if (prev === undefined) delete process.env.ZAMBAHOLA_MAX_SPREAD_BP;
  else process.env.ZAMBAHOLA_MAX_SPREAD_BP = prev;
  Object.assign(process.env, saved);
  const path = await saveReport(rows, "04-spread-gate");
  console.log("[exp04] saved", path);
  return rows;
}

/** Exp 05 — horizon sweep */
export async function experiment05Horizon(bars = 500): Promise<SweepRow[]> {
  const saved = { ...process.env };
  Object.assign(process.env, replayEnvForSweep());
  const rows: SweepRow[] = [];
  for (const h of [30, 35, 40, 45, 50, 60]) {
    const r = await replayKlineEvaluate({ bars, horizonSec: h, labelBp: 2.5 });
    rows.push({
      experiment: "05_horizon_sec",
      param: "ZAMBAHOLA_HORIZON_SEC",
      value: h,
      directionalHitRate: r.directionalHitRate,
      hitRate: r.hitRate,
      abstainRate: r.abstainRate,
      directionalCount: r.directionalCount,
    });
    console.log(`[exp05] horizon=${h}s dir=${r.directionalHitRate}`);
  }
  Object.assign(process.env, saved);
  const path = await saveReport(rows, "05-horizon");
  console.log("[exp05] saved", path);
  return rows;
}

export async function runAllExperiments(bars = 400): Promise<void> {
  console.log("[experiments] ZAMBAHOLA threshold sweep (internal replay)\n");
  await experiment01LabelBp(bars);
  await experiment02MetaThreshold(bars);
  await experiment03MinAgreement(bars);
  await experiment04SpreadGate(bars);
  await experiment05Horizon(bars);
  console.log("\n[experiments] Done — see data/learning/experiments/\n");
}
