/**
 * Public sentiment signals — no API keys.
 * - Crypto Fear & Greed Index (alternative.me)
 * - Keyword scan on CoinDesk RSS (optional)
 */

export interface SentimentSnapshot {
  score: number;
  label: string;
  source: string;
  fetchedAt: number;
  fearGreedValue?: number;
  headlineBias?: number;
}

let cache: SentimentSnapshot = {
  score: 0,
  label: "neutral",
  source: "init",
  fetchedAt: 0,
};

export function getSentiment(): SentimentSnapshot {
  return cache;
}

export async function refreshSentiment(): Promise<SentimentSnapshot> {
  let score = 0;
  let label = "neutral";
  let fearGreed: number | undefined;
  let headlineBias: number | undefined;
  const sources: string[] = [];

  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as {
      data?: Array<{ value: string; value_classification: string }>;
    };
    const item = data.data?.[0];
    if (item) {
      fearGreed = Number(item.value);
      const norm = (fearGreed - 50) / 50;
      score += norm * 0.6;
      label = item.value_classification ?? label;
      sources.push("fear_greed");
    }
  } catch {
    /* offline */
  }

  try {
    const res = await fetch("https://www.coindesk.com/arc/outboundfeeds/rss/", {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "ZambaholaAgent/0.2" },
    });
    const xml = await res.text();
    headlineBias = headlineSentiment(xml.slice(0, 8000));
    score += headlineBias * 0.4;
    sources.push("coindesk_rss");
  } catch {
    /* */
  }

  score = Math.max(-1, Math.min(1, score));
  cache = {
    score: Number(score.toFixed(4)),
    label,
    source: sources.join("+") || "fallback",
    fetchedAt: Date.now(),
    fearGreedValue: fearGreed,
    headlineBias,
  };
  return cache;
}

function headlineSentiment(text: string): number {
  const lower = text.toLowerCase();
  const bull = ["surge", "rally", "record", "bull", "gain", "soar", "approval", "inflow"];
  const bear = ["crash", "drop", "bear", "hack", "ban", "selloff", "fear", "outflow", "lawsuit"];
  let s = 0;
  for (const w of bull) if (lower.includes(w)) s += 0.08;
  for (const w of bear) if (lower.includes(w)) s -= 0.08;
  return Math.max(-1, Math.min(1, s));
}

export function startSentimentLoop(intervalMs = 120_000): () => void {
  void refreshSentiment();
  const t = setInterval(() => void refreshSentiment(), intervalMs);
  return () => clearInterval(t);
}
