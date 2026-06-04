import { runDeepBacktest } from "../backtest/deep-runner.js";

async function main(): Promise<void> {
  const limit = Number(process.env.ZAMBAHOLA_KLINES ?? 500);
  console.log(`[zambahola] deep-backtest ${limit} bars…\n`);
  const r = await runDeepBacktest(limit);
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
