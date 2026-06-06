const arg = process.argv[2] ?? "all";
const bars = Number(process.env.ZAMBAHOLA_EXP_BARS ?? 400);

async function main(): Promise<void> {
  process.env.ZAMBAHOLA_FEED ??= "mock";
  process.env.ZAMBAHOLA_ACCURACY_MODE ??= "max";
  process.env.ZAMBAHOLA_MICRO_GATES ??= "1";

  const {
    runAllExperiments,
    experiment01LabelBp,
    experiment02MetaThreshold,
    experiment03MinAgreement,
    experiment04SpreadGate,
    experiment05Horizon,
  } = await import("../evaluation/experiment-sweep.js");

  console.log(`[zambahola] experiments (${arg}) bars=${bars}\n`);

  switch (arg) {
    case "01":
    case "label-bp":
      await experiment01LabelBp(bars);
      break;
    case "02":
    case "meta":
      await experiment02MetaThreshold(bars);
      break;
    case "03":
    case "agreement":
      await experiment03MinAgreement(bars);
      break;
    case "04":
    case "spread":
      await experiment04SpreadGate(bars);
      break;
    case "05":
    case "horizon":
      await experiment05Horizon(bars);
      break;
    case "all":
    default:
      await runAllExperiments(bars);
  }

  console.log("[zambahola] experiments complete — data/learning/experiments/\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
