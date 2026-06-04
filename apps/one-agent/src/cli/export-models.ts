import { exportModelBundle } from "../learning/model-export.js";

const engine = process.env.ZAMBAHOLA_ENGINE ?? "hybrid_v7";

async function main(): Promise<void> {
  const r = await exportModelBundle(engine);
  console.log(JSON.stringify({ ok: true, ...r }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
