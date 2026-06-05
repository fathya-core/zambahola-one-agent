/**
 * Intensive teaching — before connecting exchange demo/live.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const root = join(pkgRoot, "../..");

function runNpm(args: string[], env: Record<string, string | undefined>) {
  const isWin = process.platform === "win32";
  const r = spawnSync(isWin ? "npm.cmd" : "npm", args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: isWin,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const base = {
  ZAMBAHOLA_ACCURACY_MODE: "max",
  ZAMBAHOLA_ACCURACY_FILTER: "off",
  ZAMBAHOLA_FEED: "mock",
  ZAMBAHOLA_STABILIZE: "1",
};

console.log("[zambahola] INTENSIVE TEACH — prepare for exchange demo\n");

runNpm(["run", "agent:teach-more"], {
  ...base,
  ZAMBAHOLA_TEACH_CYCLES: process.env.ZAMBAHOLA_TEACH_CYCLES ?? "20",
});

runNpm(["run", "agent:deep-learn"], {
  ...base,
  ZAMBAHOLA_DEEP_CYCLES: process.env.ZAMBAHOLA_DEEP_CYCLES ?? "10",
});

runNpm(["run", "agent:mega-train"], {
  ...base,
  ZAMBAHOLA_KLINES: process.env.ZAMBAHOLA_KLINES ?? "5000",
});

runNpm(["run", "agent:ultra-learn"], {
  ...base,
  ZAMBAHOLA_ULTRA_CYCLES: process.env.ZAMBAHOLA_ULTRA_CYCLES ?? "12",
  ZAMBAHOLA_ULTRA_KLINES: process.env.ZAMBAHOLA_ULTRA_KLINES ?? "8000",
});

runNpm(["run", "agent:export-models"], base);

console.log("\n[zambahola] Intensive teach done. Next: exchange demo — see docs/ar/ربط-بينانس.md\n");
