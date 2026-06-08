import { runLogAudit } from "../learning/log-auditor.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply;

  console.log("[zambahola] مراجع السجل — Log Reviewer");
  console.log(apply ? "  وضع: تنظيف مطبّق (--apply)" : "  وضع: معاينة فقط (أضف --apply للتنظيف)");

  const report = await runLogAudit({ dryRun });

  console.log("\n--- ملخص ---");
  console.log(`تقييمات: ${report.summary.evaluations}`);
  console.log(`Hit: ${(report.summary.hitRate * 100).toFixed(1)}%`);
  console.log(
    `اتجاهي: ${(report.summary.directionalHitRate * 100).toFixed(1)}% (${report.summary.directionalHits}/${report.summary.directionalTotal})`,
  );
  console.log(`امتناع: ${(report.summary.abstainRate * 100).toFixed(1)}%`);

  console.log("\n--- تحليل ---");
  for (const line of report.insightsAr) {
    console.log(line);
  }
  if (report.insightsAr.length === 0) {
    console.log("(لا بيانات كافية — شغّل الوكيل وانتظر تقييمات)");
  }

  if (report.cleanup.length) {
    console.log("\n--- تنظيف ---");
    for (const c of report.cleanup) {
      console.log(`  [${c.kind}] ${c.detail}${c.applied ? " ✓" : ""}`);
    }
  } else {
    console.log("\n--- تنظيف: لا إجراءات ---");
  }

  console.log("\nملفات:");
  console.log("  data/learning/LOG-AUDIT-REPORT.json");
  console.log("  data/learning/LOG-AUDIT-REPORT.md");

  if (!apply && report.cleanup.length) {
    console.log("\nلتطبيق التنظيف: npm run agent:log-review -- --apply");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
