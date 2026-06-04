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
      ["Ticks", m.tickCount],
      ["Predictions", m.predictionCount],
      ["Hit rate", (m.hitRate * 100).toFixed(1) + "%"],
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
