import { AgentCore, type AgentCoreOptions } from "../agent-core.js";
import { createAgentServer } from "../server/index.js";
import { DASHBOARD_PORT } from "../storage/paths.js";
import { readMetrics } from "../storage/index.js";
import type { AgentMetrics, AgentStatus } from "../types.js";

export interface ZambaholaAgentOptions extends AgentCoreOptions {
  port?: number;
  openBrowser?: boolean;
}

export interface ZambaholaAgent {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): AgentStatus;
  getMetrics(): Promise<AgentMetrics>;
  getTrades(): ReturnType<AgentCore["broker"]["getAllTrades"]>;
}

export function createZambaholaAgent(
  options: ZambaholaAgentOptions = {},
): ZambaholaAgent {
  const port = options.port ?? DASHBOARD_PORT;
  const core = new AgentCore(options);
  const http = createAgentServer(core, port);
  let listening = false;

  return {
    async start() {
      await http.listen();
      listening = true;
      await core.start();
    },
    async stop() {
      await core.stop();
      if (listening) {
        await http.close();
        listening = false;
      }
    },
    getStatus() {
      return core.getStatus(port);
    },
    async getMetrics() {
      return (await readMetrics()) ?? core.getRuntimeState().metrics;
    },
    getTrades() {
      return core.broker.getAllTrades();
    },
  };
}

export { AgentCore, DASHBOARD_PORT };
