import { restoreBestWeightsToFile, loadBestWeights } from "../learning/weight-snapshot.js";

async function main(): Promise<void> {
  const best = await loadBestWeights();
  if (!best) {
    console.log(JSON.stringify({ ok: false, reason: "no_snapshot" }, null, 2));
    process.exit(1);
  }
  const meta = await restoreBestWeightsToFile();
  console.log(
    JSON.stringify(
      {
        ok: true,
        restoredHitRate: meta?.hitRate,
        savedAt: meta?.savedAt,
        message: "Restart agent to load restored weights",
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
