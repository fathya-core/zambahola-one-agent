const $ = (id) => document.getElementById(id);

async function fetchJson(path) {
  const res = await fetch(path);
  return res.json();
}

function renderMetrics(m) {
    const rows = [
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
      ["Hit rate", (m.hitRate * 100).toFixed(1) + "%"],
      ["Directional hit", m.directionalHitRate != null ? (m.directionalHitRate * 100).toFixed(1) + "%" : "—"],
      ["Dir. signals", m.directionalCount != null ? String(m.directionalCount) : "—"],
      ["Abstain rate", m.abstainRate != null ? (m.abstainRate * 100).toFixed(1) + "%" : "—"],
      ["Rolling hit (60)", m.rollingHitRate != null ? (m.rollingHitRate * 100).toFixed(1) + "%" : "—"],
      ["Dir. rolling (60)", m.directionalRollingHitRate != null ? (m.directionalRollingHitRate * 100).toFixed(1) + "%" : "—"],
      ["Peak hit", m.peakHitRate != null ? (m.peakHitRate * 100).toFixed(1) + "%" : "—"],
      ["Stabilize mode", m.stabilizeMode ? "ON (حماية)" : "off"],
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
      $("horizon").textContent = "horizon " + prediction.horizonSec + "s";
      const why = prediction.meta?.gateReason || prediction.meta?.expertReason;
      if (why) {
        $("decision-reason").textContent = why;
      }
    }

    if (metrics.lastDecision) {
      $("decision").textContent = metrics.lastDecision.action;
      $("decision-reason").textContent = metrics.lastDecision.reason;
    }

    renderMetrics(metrics);
    $("position").textContent = JSON.stringify(
      { openPosition: metrics.openPosition, paperPnl: metrics.paperPnl },
      null,
      2,
    );

    const learn = await fetchJson("/api/learning");
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
