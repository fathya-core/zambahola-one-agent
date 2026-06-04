import { runBacktest } from "../backtest/runner.js";

async function main(): Promise<void> {
  console.log("[zambahola] backtest starting…\n");
  const result = await runBacktest();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
