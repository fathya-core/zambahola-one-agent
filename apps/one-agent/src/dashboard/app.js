const $ = (id) => document.getElementById(id);

async function fetchJson(path) {
  const res = await fetch(path);
  return res.json();
}

function formatCountdown(ms) {
  if (ms == null || ms <= 0) return "—";
  const s = Math.ceil(ms / 1000);
  return s + "s";
}

function renderDualAgent(dual, logAudit, analyst, learn) {
  const pills = $("dual-agent-pills");
  if (!pills) return;

  const primaryOn = dual?.sessionEvaluations > 0;
  const secondaryOn = (dual?.sessionLogAudits ?? 0) > 0 || (dual?.sessionSkillApplies ?? 0) > 0;
  const warmed = dual?.auditWarmedUp;

  pills.innerHTML = [
    `<span class="agent-pill ${primaryOn ? "active" : ""}">① تعلّم مباشر ${primaryOn ? "نشط" : "—"}</span>`,
    `<span class="agent-pill ${secondaryOn ? "active" : warmed ? "active" : "wait"}">② مراجع السجل ${secondaryOn ? "نشط" : warmed ? "جاهز" : "ينتظر"}</span>`,
    `<span class="agent-pill ${dual?.analystAutoApply ? "active" : ""}">مهارات تلقائية ${dual?.analystAutoApply ? "ON" : "OFF"}</span>`,
  ].join("");

  const skills = analyst?.skillAppliedAr?.length
    ? analyst.skillAppliedAr
    : learn?.skillAppliedAr ?? [];
  const auditSummary = logAudit?.report?.summary ?? logAudit?.summary ?? learn?.logAuditSummary;
  const lines = [
    dual?.statusAr ?? "—",
    "",
    `تقييمات الجلسة: ${dual?.sessionEvaluations ?? 0}`,
    `مراجعات الجلسة: ${dual?.sessionLogAudits ?? 0} · تطبيق مهارات: ${dual?.sessionSkillApplies ?? 0}`,
    `المراجعة القادمة بعد: ${dual?.nextAuditInEvals ?? "—"} تقييم`,
    `المحلل القادم بعد: ${dual?.nextAnalystApplyInEvals ?? "—"} تقييم`,
  ];
  if (auditSummary && typeof auditSummary.hitRate === "number") {
    lines.push(
      "",
      `آخر مراجعة — hit شامل ${(auditSummary.hitRate * 100).toFixed(1)}% · dir ${(auditSummary.directionalHitRate * 100).toFixed(1)}% (${auditSummary.directionalTotal ?? 0}) · range ${(auditSummary.abstainRate * 100).toFixed(1)}%`,
    );
  }
  if (skills.length) {
    lines.push("", "مهارات مطبّقة:", ...skills.map((s) => "• " + s));
  }
  $("dual-agent").textContent = lines.join("\n");
}

function renderMetrics(m) {
    const rows = [
      ["Local time", m.nowLocal ?? "—"],
      ["Last tick", m.lastTickLocal ?? "—"],
      ["Tick age", m.lastTickAgeSec != null ? m.lastTickAgeSec + "s" : "—"],
      ["Uptime", m.uptimeLabel ?? "—"],
      ["Timezone", m.timezone ?? "—"],
      ["Feed", m.feedName ?? "—"],
      ["Regime", m.regime ?? "—"],
      ["Sentiment", m.sentimentScore ?? "—"],
      ["ML samples", m.mlSamples ?? 0],
      ["MLP samples", m.mlpSamples ?? 0],
      ["GBM trees", m.gbmSamples ?? 0],
      ["Understanding", m.understandingScore != null ? (m.understandingScore * 100).toFixed(1) + "%" : "—"],
      ["Live evals", m.liveEvaluations ?? 0],
      ["Learning updates", m.learningUpdates ?? 0],
      ["Ticks", m.tickCount],
      ["Predictions", m.predictionCount],
      [
        "Hit (incl. range)",
        (m.hitRate * 100).toFixed(1) +
          "%" +
          (m.directionalCount != null && m.directionalCount < 5 ? " · inflated" : ""),
      ],
      [
        "Directional hit (goal)",
        m.directionalCount != null && m.directionalCount < 3
          ? "— (few signals)"
          : m.directionalHitRate != null
            ? (m.directionalHitRate * 100).toFixed(1) + "%"
            : "—",
      ],
      ["Dir. signals", m.directionalCount != null ? String(m.directionalCount) : "—"],
      [
        "Range share",
        m.abstainRate != null ? (m.abstainRate * 100).toFixed(1) + "%" : "—",
      ],
      ["Paper trades", m.closedTradeCount != null ? String(m.closedTradeCount) : "—"],
      ["Learn-trade", m.learnTradeMode ? "ON (تعلّم)" : "off"],
      ["Hybrid auto", m.hybridAuto ? "ON" : "off"],
      [
        "Hybrid profile",
        m.hybridProfile === "learn"
          ? "learn (range)"
          : m.hybridProfile === "signals"
            ? "signals (trend)"
            : "—",
      ],
      ["Intensive learn", m.intensiveLearn ? "ON (مكثّف)" : "off"],
      ["Recovery mode", m.recoveryMode ? "ON (تسريع)" : "off"],
      ["Hit recover", m.hitRecoverMode ? "ON (هدف 50%+)" : "off"],
      ["Rolling hit (60)", m.rollingHitRate != null ? (m.rollingHitRate * 100).toFixed(1) + "%" : "—"],
      ["Dir. rolling (60)", m.directionalRollingHitRate != null ? (m.directionalRollingHitRate * 100).toFixed(1) + "%" : "—"],
      ["Peak hit", m.peakHitRate != null ? (m.peakHitRate * 100).toFixed(1) + "%" : "—"],
      ["Stabilize mode", m.stabilizeMode ? "ON (حماية)" : "off"],
      ["Session evals", m.sessionEvaluations != null ? String(m.sessionEvaluations) : "—"],
      ["Session log audits", m.sessionLogAudits != null ? String(m.sessionLogAudits) : "—"],
      ["Session skill applies", m.sessionSkillApplies != null ? String(m.sessionSkillApplies) : "—"],
    ["Paper PnL", m.paperPnl],
    ["Avg win", m.averageWin],
    ["Avg loss", m.averageLoss],
    ["False positive rate", (m.falsePositiveRate * 100).toFixed(1) + "%"],
    ["Confidence calibration", m.confidenceCalibration],
    ["Max drawdown", m.maxDrawdown],
    ["Open position", m.openPosition ?? "flat"],
  ];
  $("metrics").innerHTML = rows
    .map(
      ([k, v]) =>
        `<div><dt>${k}</dt><dd>${v}</dd></div>`,
    )
    .join("");
}

async function refresh() {
  try {
    const [status, metrics, prediction] = await Promise.all([
      fetchJson("/api/status"),
      fetchJson("/api/metrics"),
      fetchJson("/api/prediction/latest"),
    ]);

    const pill = $("status-pill");
    pill.textContent = status.running ? "agent live" : "agent stopped";
    pill.className = "pill" + (status.running ? " live" : "");

    if (status.time) {
      $("clock").textContent =
        status.time.nowLocal +
        " (" +
        status.time.timezone +
        ") · تشغيل " +
        status.time.uptimeLabel;
    }

    $("price").textContent =
      metrics.lastPrice != null
        ? "$" + Number(metrics.lastPrice).toLocaleString()
        : "—";

    if (prediction && prediction.direction) {
      const el = $("prediction");
      el.textContent = prediction.direction.toUpperCase();
      el.className = "big pred-" + prediction.direction;
      $("confidence").textContent =
        "confidence " + (prediction.confidence * 100).toFixed(1) + "%";
      const evalAt =
        prediction.timestamp + prediction.horizonSec * 1000 - Date.now();
      $("horizon").textContent =
        "horizon " +
        prediction.horizonSec +
        "s · eval in " +
        formatCountdown(evalAt);
      const why =
        prediction.meta?.analystSummaryAr ||
        prediction.meta?.gateReason ||
        prediction.meta?.expertReason;
      if (why) {
        $("decision-reason").textContent = why;
      }
    }

    if (metrics.lastDecision) {
      $("decision").textContent = metrics.lastDecision.action;
      $("decision-reason").textContent = metrics.lastDecision.reason;
    }

    const timeMeta = status.time ?? {};
    renderMetrics({
      ...metrics,
      nowLocal: timeMeta.nowLocal,
      lastTickLocal: timeMeta.lastTickLocal,
      lastTickAgeSec: timeMeta.lastTickAgeSec,
      uptimeLabel: timeMeta.uptimeLabel,
      timezone: timeMeta.timezone,
    });
    $("position").textContent = JSON.stringify(
      { openPosition: metrics.openPosition, paperPnl: metrics.paperPnl },
      null,
      2,
    );

    const [analyst, cal, logAudit, learn] = await Promise.all([
      fetchJson("/api/analyst"),
      fetchJson("/api/calibration"),
      fetchJson("/api/log-audit").catch(() => null),
      fetchJson("/api/learning"),
    ]);
    renderDualAgent(
      analyst.dualAgent ?? learn.dualAgent,
      logAudit,
      analyst,
      learn,
    );
    $("analyst").textContent =
      analyst.summaryAr +
      "\n\n" +
      (analyst.bulletsAr ?? []).map((l) => "• " + l).join("\n");
    $("calibration").textContent = JSON.stringify(
      { score: cal.score, samples: cal.samples, curve: cal.curve },
      null,
      2,
    );

    const insights = learn.patternInsightsAr ?? [];
    $("learning").textContent =
      (insights.length
        ? "تحليل الأنماط:\n" + insights.map((l) => "• " + l).join("\n") + "\n\n"
        : "") +
      JSON.stringify(
      {
        understandingScore: learn.understandingScore,
        hitRateEma: learn.hitRateEma,
        metaLabel: learn.metaLabel,
        totalEvaluations: learn.totalEvaluations,
        sessionEvaluations: learn.sessionEvaluations,
        sessionLogAudits: learn.sessionLogAudits,
        sessionSkillApplies: learn.sessionSkillApplies,
        logAudits: learn.logAudits,
        totalLearningUpdates: learn.totalLearningUpdates,
        orchestratorBoosts: learn.orchestratorBoosts,
        modelExports: learn.modelExports,
        mlSamples: learn.mlSamples,
        howItWorks: learn.howItWorks,
      },
      null,
      2,
    );

    const strat = await fetchJson("/api/strategies");
    $("strategies").textContent = JSON.stringify(strat, null, 2);

    if (!$("knowledge").dataset.loaded) {
      const know = await fetchJson("/api/knowledge");
      $("knowledge").textContent = JSON.stringify(
        {
          books: know.books?.length,
          strategies: know.strategies?.length,
          news: know.news?.length,
          accuracyMethods: know.accuracyMethods,
        },
        null,
        2,
      );
      $("knowledge").dataset.loaded = "1";
    }
  } catch {
    $("status-pill").textContent = "offline";
  }
}

refresh();
setInterval(refresh, 1000);
