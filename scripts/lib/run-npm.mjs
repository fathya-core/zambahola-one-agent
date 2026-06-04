import { spawnSync } from "node:child_process";

/**
 * Cross-platform npm runner (Windows needs shell or npm.cmd).
 */
export function runNpm(args, { cwd, env = process.env, stdio = "inherit" } = {}) {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npm.cmd" : "npm";
  const r = spawnSync(cmd, args, {
    cwd,
    env,
    stdio,
    shell: isWin,
  });
  if (r.error) {
    console.error("[zambahola] npm spawn error:", r.error.message);
    return { ok: false, status: 1 };
  }
  const status = r.status ?? 1;
  if (status !== 0 && stdio === "inherit") {
    console.error(`[zambahola] npm ${args.join(" ")} exited with code ${status}`);
  }
  return { ok: status === 0, status };
}
