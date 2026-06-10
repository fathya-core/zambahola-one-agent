/**
 * Shared diagnosis + auto-fix rules for agent-guard (local) and cloud review.
 */

export function diagnoseSnapshot(snap) {
  const issues = [];
  const fixes = [];
  const status = snap?.status ?? {};
  const metrics = snap?.metrics ?? {};
  const learning = snap?.learning ?? snap?.dualAgent ?? {};
  const dual = snap?.dualAgent ?? learning?.dualAgent ?? {};
  const time = status?.time ?? {};

  if (!status.running) {
    issues.push({ id: "agent_stopped", severity: "critical", ar: "الوكيل متوقف" });
    const restart =
      process.env.ZAMBAHOLA_GUARD_RESTART ??
      (process.env.ZAMBAHOLA_PHASE5 === "1" ? "phase5-reload" : "phase4-hit-recover");
    fixes.push({ action: restart, via: "npm", reason: "restart agent" });
    return { issues, fixes, healthy: false };
  }

  const tickAge = time.lastTickAgeSec ?? 999;
  if (tickAge > 45) {
    issues.push({
      id: "stale_ticks",
      severity: "high",
      ar: `آخر tick منذ ${tickAge}ث — قد يكون التغذية معلقة`,
    });
    fixes.push({ action: "health-check", via: "npm", reason: "diagnose feed" });
  }

  const abstain = metrics.abstainRate ?? 0;
  const dirCount = metrics.directionalCount ?? 0;
  const uptime = time.uptimeSec ?? 0;

  if (uptime >= 600 && abstain < 0.35 && dirCount > 200) {
    const dirHit = metrics.directionalHitRate ?? 0;
    if (dirHit < 0.45) {
      issues.push({
        id: "overtrading",
        severity: "high",
        ar: `إشارات كثيرة ضعيفة — امتناع ${(abstain * 100).toFixed(0)}% · اتجاهي ${(dirHit * 100).toFixed(1)}%`,
      });
      fixes.push({ action: "log-review:apply", via: "api", reason: "expert tighten" });
    }
  }

  if (uptime >= 600 && abstain >= 0.92 && dirCount < 5) {
    issues.push({
      id: "abstain_lock",
      severity: "high",
      ar: `امتناع ${(abstain * 100).toFixed(0)}% — إشارات اتجاهية شبه معدومة`,
    });
    fixes.push({ action: "analyst-apply", via: "api", reason: "analyst skills" });
    fixes.push({ action: "log-review:apply", via: "api", reason: "log cleanup" });
  }

  const sessEvals = dual.sessionEvaluations ?? metrics.sessionEvaluations ?? 0;
  const sessAudits = dual.sessionLogAudits ?? metrics.sessionLogAudits ?? 0;
  if (uptime >= 300 && sessEvals >= 60 && sessAudits === 0) {
    issues.push({
      id: "dual_agent_silent",
      severity: "medium",
      ar: "الوكيل الثاني لم يراجع السجل هذه الجلسة",
    });
    fixes.push({ action: "log-review:apply", via: "api", reason: "force log audit" });
  }

  const latentUp = metrics.lastPrediction?.meta?.latentSTierUp ?? 0;
  const latentPromoted = metrics.lastPrediction?.meta?.latentPromoted;
  if (
    uptime >= 300 &&
    abstain >= 0.85 &&
    latentUp >= 2 &&
    !latentPromoted
  ) {
    issues.push({
      id: "latent_not_promoted",
      severity: "high",
      ar: "إجماع S-tier موجود لكن الكود القديم — يحتاج git pull",
    });
    fixes.push({ action: "push-telemetry", via: "npm", reason: "notify cloud" });
  }

  const hit = metrics.hitRate ?? 0;
  const dirHit = metrics.directionalHitRate ?? 0;
  if (dirCount >= 20 && dirHit < 0.35) {
    issues.push({
      id: "low_directional_hit",
      severity: "medium",
      ar: `اتجاهي ${(dirHit * 100).toFixed(1)}% — ضعيف`,
    });
    fixes.push({ action: "patterns", via: "npm", reason: "refresh pattern journal" });
    fixes.push({ action: "restore-weights", via: "npm", reason: "best snapshot" });
  }

  if (hit > 0.85 && abstain > 0.9) {
    issues.push({
      id: "misleading_hit",
      severity: "info",
      ar: "hit الكلي مرتفع لكنه range فقط — لا يعني دقة اتجاهية",
    });
  }

  const critical = issues.filter((i) => i.severity === "critical" || i.severity === "high");
  return {
    issues,
    fixes: dedupeFixes(fixes),
    healthy: critical.length === 0,
  };
}

function dedupeFixes(fixes) {
  const seen = new Set();
  return fixes.filter((f) => {
    const k = `${f.via}:${f.action}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
