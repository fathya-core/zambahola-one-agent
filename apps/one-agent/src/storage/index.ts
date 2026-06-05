import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { readJsonSafe, writeJsonAtomic } from "./json-io.js";
import type { AgentMetrics, RunRecord } from "../types.js";
import {
  CURRENT_METRICS_FILE,
  DATA_ROOT,
  LATEST_RUN_FILE,
  METRICS_DIR,
  PAPER_LEDGER_FILE,
  RECEIPTS_DIR,
  RUNS_DIR,
  TRADES_DIR,
} from "./paths.js";

export async function ensureDataDirs(): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });
  await mkdir(TRADES_DIR, { recursive: true });
  await mkdir(METRICS_DIR, { recursive: true });
  await mkdir(RECEIPTS_DIR, { recursive: true });
}

export async function appendRun(record: RunRecord): Promise<void> {
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(LATEST_RUN_FILE, line, "utf8");
}

export async function appendTradeLedger(payload: unknown): Promise<void> {
  const line = `${JSON.stringify({ ...((typeof payload === "object" && payload) || {}), timestamp: Date.now() })}\n`;
  await appendFile(PAPER_LEDGER_FILE, line, "utf8");
}

export async function writeMetrics(metrics: AgentMetrics): Promise<void> {
  await writeJsonAtomic(CURRENT_METRICS_FILE, metrics);
}

export async function readMetrics(): Promise<AgentMetrics | null> {
  return readJsonSafe<AgentMetrics>(CURRENT_METRICS_FILE);
}

export async function writeReceipt(name: string, payload: unknown): Promise<string> {
  const file = `${RECEIPTS_DIR}/${name}-${Date.now()}.json`;
  await writeFile(
    file,
    JSON.stringify({ payload, timestamp: Date.now() }, null, 2),
    "utf8",
  );
  return file;
}

export async function resetRunFiles(): Promise<void> {
  await ensureDataDirs();
  await writeFile(LATEST_RUN_FILE, "", "utf8");
  await writeFile(PAPER_LEDGER_FILE, "", "utf8");
}

export { DATA_ROOT, LATEST_RUN_FILE, PAPER_LEDGER_FILE, CURRENT_METRICS_FILE };
