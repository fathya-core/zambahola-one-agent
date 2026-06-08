import type { PredictionMeta } from "../types.js";
import type { PatternJournalData } from "./pattern-journal.js";

const GATE_AR: Record<string, string> = {
  micro_spread: "السبريد عالي — تكلفة الدخول كبيرة، الوكيل يمتنع.",
  micro_vol: "التذبذب مرتفع — خطر انعكاس سريع.",
  micro_imbalance: "دفتر الأوامر ما يدعم الاتجاه — ضعف في الضغط.",
  micro_main_prob: "ثقة النموذج الأساسي أقل من العتبة المطلوبة.",
  meta_label_abstain: "Meta-label يقول: الإشارة غير موثوقة.",
  meta_pnl_abstain: "Meta-PnL يقول: توقع الربح ضعيف.",
  agreement: "اتفاق الاستراتيجيات غير كافٍ.",
  model_voters: "نماذج ML ما اتفقت بقوة.",
  low_confidence: "ثقة منخفضة بعد المعايرة.",
  high_vol: "نظام تذبذب عالي — يحتاج إجماع أقوى.",
  expert_block: "خبير الاستراتيجيات حظر الإشارة (مثلاً mean_reversion ضد الترند).",
  range_abstain: "امتناع طبيعي — السوق في نطاق.",
};

function matchGate(reason: string): string | null {
  for (const [key, ar] of Object.entries(GATE_AR)) {
    if (reason.includes(key)) return ar;
  }
  return null;
}

export function explainGateReasonAr(gateReason?: string): string {
  if (!gateReason || gateReason === "n/a") {
    return "لا سبب مسجّل بعد.";
  }
  const parts = gateReason.split("|").map((p) => p.trim());
  const lines: string[] = [];
  for (const p of parts) {
    const ar = matchGate(p);
    lines.push(ar ?? `بوابة: ${p}`);
  }
  return lines.join(" · ");
}

export function explainPredictionAr(meta?: PredictionMeta): string[] {
  if (!meta) return ["لا بيانات تنبؤ بعد."];

  const lines: string[] = [];
  const regime = meta.regime ?? "غير معروف";
  lines.push(`النظام السوقي: ${regime}`);

  if (meta.agreement != null) {
    lines.push(`اتفاق الـ ${meta.strategyCount ?? 17} استراتيجية: ${(meta.agreement * 100).toFixed(1)}%`);
  }

  if (meta.tierSVotes != null) {
    lines.push(`أصوات S-tier (ترند/مايكرو): ${meta.tierSVotes}`);
  }

  if (meta.metaLabelProb != null) {
    lines.push(
      `Meta-label ثقة: ${(meta.metaLabelProb * 100).toFixed(1)}% ${meta.metaTrust === false ? "→ امتناع" : "→ موثوق"}`,
    );
  }

  if (meta.mlProb != null) {
    lines.push(
      `ML ${(meta.mlProb * 100).toFixed(0)}% · MLP ${((meta.mlpProb ?? 0.5) * 100).toFixed(0)}% · GBM ${((meta.gbmProb ?? 0.5) * 100).toFixed(0)}%`,
    );
  }

  if (meta.gateReason) {
    lines.push(`السبب: ${explainGateReasonAr(meta.gateReason)}`);
  }

  if (meta.qualityTier === "high") {
    lines.push("✅ جودة عالية — إشارة قوية.");
  } else if (meta.qualityTier === "abstain") {
    lines.push("⏸ امتناع — الأفضل عدم الدخول.");
  }

  return lines.slice(0, 8);
}

export function buildAnalystReportAr(
  meta?: PredictionMeta,
  patterns?: PatternJournalData,
  logAuditInsights?: string[],
  skillAppliedAr?: string[],
): {
  summaryAr: string;
  bulletsAr: string[];
  updatedAt: number;
} {
  const bullets = explainPredictionAr(meta);
  if (patterns?.recentInsightsAr?.length) {
    bullets.push("---");
    bullets.push(...patterns.recentInsightsAr.slice(0, 4));
  }
  if (logAuditInsights?.length) {
    bullets.push("--- مراجع السجل ---");
    bullets.push(...logAuditInsights.slice(0, 4));
  }
  if (skillAppliedAr?.length) {
    bullets.push("--- مهارات طُبّقت ---");
    bullets.push(...skillAppliedAr.slice(0, 6));
  }

  const dir = meta?.gateReason?.includes("abstain") || meta?.qualityTier === "abstain"
    ? "امتناع"
    : "إشارة اتجاهية";

  return {
    summaryAr: `تحليل الوكيل: ${dir} · نظام ${meta?.regime ?? "—"}`,
    bulletsAr: bullets,
    updatedAt: Date.now(),
  };
}
