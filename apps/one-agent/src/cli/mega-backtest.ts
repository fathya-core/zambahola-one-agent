import { runMegaBacktest } from "../backtest/mega-runner.js";

async function main(): Promise<void> {
  const limit = Number(process.env.ZAMBAHOLA_KLINES ?? 1200);
  console.log(`[zambahola] MEGA BACKTEST ${limit} bars…\n`);
  const r = await runMegaBacktest(limit);
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
