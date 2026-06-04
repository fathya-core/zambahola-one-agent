import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const DATA_ROOT = join(pkgRoot, "data");
export const RUNS_DIR = join(DATA_ROOT, "runs");
export const TRADES_DIR = join(DATA_ROOT, "trades");
export const METRICS_DIR = join(DATA_ROOT, "metrics");
export const RECEIPTS_DIR = join(DATA_ROOT, "receipts");

export const LATEST_RUN_FILE = join(RUNS_DIR, "latest.jsonl");
export const PAPER_LEDGER_FILE = join(TRADES_DIR, "paper-ledger.jsonl");
export const CURRENT_METRICS_FILE = join(METRICS_DIR, "current.json");
export const AGENT_PID_FILE = join(DATA_ROOT, "agent.pid");
export const AGENT_STATUS_FILE = join(DATA_ROOT, "agent-status.json");

export const DASHBOARD_PORT = 8787;
