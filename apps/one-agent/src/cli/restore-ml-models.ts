import { restoreMlMlpWeights } from "../learning/model-weight-health.js";

async function main(): Promise<void> {
  const result = await restoreMlMlpWeights();
  console.log(
    JSON.stringify(
      {
        ok: true,
        ...result,
        message: "Restart agent (agent:phase5-reload) to load restored ML/MLP weights",
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
