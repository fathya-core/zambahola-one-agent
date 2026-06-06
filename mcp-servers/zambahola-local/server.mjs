#!/usr/bin/env node
/**
 * ZAMBAHOLA Local MCP Server (stdio)
 * Connects Cursor on your PC to the running agent + local bridge.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const bridgeUrl = process.env.ZAMBAHOLA_BRIDGE_URL ?? "http://127.0.0.1:8790";
const agentUrl = process.env.ZAMBAHOLA_AGENT_URL ?? "http://127.0.0.1:8787";
const token = process.env.ZAMBAHOLA_BRIDGE_TOKEN ?? "";

const TOOLS = [
  {
    name: "zambahola_get_telemetry",
    description: "Full telemetry snapshot from local bridge (metrics, analyst, calibration)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zambahola_get_metrics",
    description: "Current agent metrics from dashboard API",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zambahola_get_analyst",
    description: "Arabic analyst report — why abstain or signal",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zambahola_get_patterns",
    description: "Pattern journal insights (regime × strategy × gates)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zambahola_queue_command",
    description: "Queue a remote command for local watcher (research-import, stop, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string" },
        payload: { type: "object" },
      },
      required: ["action"],
    },
  },
  {
    name: "zambahola_read_telemetry_file",
    description: "Read LOCAL-TELEMETRY.json from disk (offline)",
    inputSchema: { type: "object", properties: {} },
  },
];

async function httpGet(base, path) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${base}${path}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

async function httpPost(base, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

async function handleTool(name, args) {
  switch (name) {
    case "zambahola_get_telemetry":
      return await httpGet(bridgeUrl, "/telemetry");
    case "zambahola_get_metrics":
      return await httpGet(agentUrl, "/api/metrics");
    case "zambahola_get_analyst":
      return await httpGet(agentUrl, "/api/analyst");
    case "zambahola_get_patterns":
      return await httpGet(agentUrl, "/api/patterns");
    case "zambahola_queue_command":
      return await httpPost(bridgeUrl, "/command", {
        action: args.action,
        payload: args.payload ?? {},
        source: "mcp",
      });
    case "zambahola_read_telemetry_file": {
      const f = join(root, "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json");
      if (!existsSync(f)) return { error: "no telemetry file — run agent:local-bridge" };
      return JSON.parse(await readFile(f, "utf8"));
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    void handleLine(JSON.parse(line));
  }
});

async function handleLine(req) {
  const { id, method, params } = req;
  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "zambahola-local", version: "0.2.0" },
        },
      });
      return;
    }
    if (method === "notifications/initialized") return;
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (method === "tools/call") {
      const result = await handleTool(params.name, params.arguments ?? {});
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      });
      return;
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown: ${method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e) } });
  }
}
