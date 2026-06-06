import { getPatternJournal, flushJournal } from "../learning/pattern-journal.js";
import { getMetaLabeler } from "../learning/meta-label.js";

async function main(): Promise<void> {
  await flushJournal();
  const journal = await getPatternJournal();
  const meta = await getMetaLabeler();

  console.log("[zambahola] Pattern Journal\n");
  console.log("Evaluations:", journal.totalEvaluations);
  console.log("\n--- تحليل عربي ---\n");
  for (const line of journal.recentInsightsAr) {
    console.log(line);
  }
  if (journal.recentInsightsAr.length === 0) {
    console.log("(لا بيانات كافية — شغّل الوكيل وانتظر 25+ تقييم)");
  }
  console.log("\n--- Meta-label ---");
  console.log(JSON.stringify(meta.getState(), null, 2));
  console.log("\nFiles:");
  console.log("  data/learning/pattern-journal.md");
  console.log("  data/learning/pattern-journal.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
