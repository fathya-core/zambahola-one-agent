import { runMegaTrain } from "../learning/batch-trainer.js";

async function main(): Promise<void> {
  const bars = Number(process.env.ZAMBAHOLA_KLINES ?? 1200);
  console.log(`[zambahola] MEGA TRAIN on ${bars} bars…\n`);
  const r = await runMegaTrain(bars);
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
