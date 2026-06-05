import { runCurriculum } from "../learning/curriculum-runner.js";

async function main(): Promise<void> {
  process.env.ZAMBAHOLA_EXPERT ??= "1";
  process.env.ZAMBAHOLA_STABILIZE ??= "1";
  process.env.ZAMBAHOLA_ACCURACY_MODE ??= "max";

  console.log("[zambahola] EXPERT CURRICULUM — 4 directed phases\n");

  const r = await runCurriculum();
  console.log("\n[curriculum] Summary:", JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
