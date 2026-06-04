/**
 * MCP tools scaffold for ZAMBAHOLA ONE AGENT v0.
 * Wire these to a Cursor MCP server host when ready.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  CURRENT_METRICS_FILE,
  PAPER_LEDGER_FILE,
  AGENT_STATUS_FILE,
} from "../storage/paths.js";
import { readMetrics } from "../storage/index.js";
import type { AgentMetrics } from "../types.js";

export const MCP_TOOL_NAMES = [
  "trading.startPaperRun",
  "trading.stopRun",
  "trading.getStatus",
  "trading.getLatestPrediction",
  "trading.getMetrics",
  "trading.getPaperTrades",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export interface McpToolDescriptor {
  name: McpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: "trading.startPaperRun",
    description: "Start the local paper-trading agent (via pnpm agent:start)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "trading.stopRun",
    description: "Stop the running agent",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "trading.getStatus",
    description: "Read agent status from disk",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "trading.getLatestPrediction",
    description: "Latest prediction from metrics file",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "trading.getMetrics",
    description: "Current metrics snapshot",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "trading.getPaperTrades",
    description: "Paper ledger lines",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  },
];

export async function handleMcpTool(
  name: McpToolName,
  _args: Record<string, unknown> = {},
): Promise<unknown> {
  switch (name) {
    case "trading.startPaperRun":
      return {
        message: "Run: pnpm agent:start",
        note: "MCP host should spawn CLI; scaffold only in v0",
      };
    case "trading.stopRun":
      return { message: "Run: pnpm agent:stop" };
    case "trading.getStatus":
      if (!existsSync(AGENT_STATUS_FILE)) return { running: false };
      return JSON.parse(await readFile(AGENT_STATUS_FILE, "utf8"));
    case "trading.getLatestPrediction": {
      const m = await readMetrics();
      return m?.lastPrediction ?? null;
    }
    case "trading.getMetrics":
      return (await readMetrics()) as AgentMetrics | null;
    case "trading.getPaperTrades": {
      if (!existsSync(PAPER_LEDGER_FILE)) return [];
      const raw = await readFile(PAPER_LEDGER_FILE, "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const limit = Number(_args.limit ?? 50);
      return lines.slice(-limit).map((l) => JSON.parse(l));
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export { CURRENT_METRICS_FILE, PAPER_LEDGER_FILE };
