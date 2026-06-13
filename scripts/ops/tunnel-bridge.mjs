#!/usr/bin/env node
/**
 * Optional ngrok tunnel for local bridge (requires ngrok on PATH).
 * Exposes http://127.0.0.1:8790 to internet — use with ZAMBAHOLA_BRIDGE_TOKEN!
 */
import { spawn } from "node:child_process";

const port = process.env.ZAMBAHOLA_BRIDGE_PORT ?? "8790";

console.log(`[tunnel] Starting ngrok → port ${port}`);
console.log("[tunnel] REQUIRE ZAMBAHOLA_BRIDGE_TOKEN in bridge.env");
console.log("[tunnel] Install: https://ngrok.com/download");

const child = spawn("ngrok", ["http", port], { stdio: "inherit", shell: true });
child.on("error", () => {
  console.error("[tunnel] ngrok not found — use git push telemetry instead");
  process.exit(1);
});
