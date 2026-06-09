import { spawnSync } from "node:child_process";

/**
 * Cross-platform npm runner.
 * Windows: npm.cmd is a batch file — must run via cmd.exe (direct spawn → EINVAL).
 */
export function runNpm(args, { cwd, env = process.env, stdio = "inherit" } = {}) {
  const isWin = process.platform === "win32";
  const command = isWin ? "cmd.exe" : "npm";
  const argv = isWin ? ["/d", "/s", "/c", "npm", ...args] : args;
  const r = spawnSync(command, argv, {
    cwd,
    env,
    stdio,
    windowsHide: isWin,
    shell: false,
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
