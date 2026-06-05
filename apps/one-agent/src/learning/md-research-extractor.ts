import type { ResearchImportEntry } from "../knowledge/research-import-loader.js";

/** All 17 strategy ids — must match prediction-engine */
export const STRATEGY_IDS = [
  "momentum",
  "mean_reversion",
  "rsi",
  "ema_cross",
  "macd",
  "bollinger",
  "volatility_regime",
  "atr_breakout",
  "volume_breakout",
  "vwap_proxy",
  "order_imbalance",
  "funding_fade",
  "premium_momentum",
  "open_interest",
  "long_short_extreme",
  "session_bias",
  "tick_momentum",
] as const;

const STRATEGY_PATTERN = STRATEGY_IDS.join("|");

export function extractJsonBlocks(markdown: string): unknown[] {
  const out: unknown[] = [];
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const raw = m[1]!.trim();
    if (!raw.startsWith("{") && !raw.startsWith("[")) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      /* skip invalid */
    }
  }
  return out;
}

/** "momentum": 1.25 or momentum → 1.25 or momentum: 1.25 */
export function extractInlineWeights(markdown: string): Record<string, number> {
  const weights: Record<string, number> = {};
  const idGroup = `(${STRATEGY_PATTERN})`;

  const patterns = [
    new RegExp(`"${idGroup}"\\s*:\\s*([0-9]+\\.?[0-9]*)`, "gi"),
    new RegExp(`${idGroup}\\s*[:→=]\\s*([0-9]+\\.?[0-9]*)`, "gi"),
    new RegExp(`${idGroup}\\s+weight\\s*[:=]\\s*([0-9]+\\.?[0-9]*)`, "gi"),
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) {
      const id = m[1]!.toLowerCase();
      const val = Number(m[2]);
      if (val > 0 && val < 5) weights[id] = val;
    }
  }

  return weights;
}

function pickWeightAdjustments(obj: unknown): Record<string, number> | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  if (o.weightAdjustments && typeof o.weightAdjustments === "object") {
    return o.weightAdjustments as Record<string, number>;
  }
  if (o.weights && typeof o.weights === "object") {
    return o.weights as Record<string, number>;
  }
  const direct: Record<string, number> = {};
  for (const id of STRATEGY_IDS) {
    if (typeof o[id] === "number") direct[id] = o[id] as number;
  }
  return Object.keys(direct).length ? direct : undefined;
}

function pickMinDirectional(obj: unknown): number | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  const v =
    o.minDirectionalHitTarget ??
    o.directionalHitTarget ??
    o.min_hit_rate ??
    o.targetHitRate;
  return typeof v === "number" ? v : undefined;
}

/** One markdown file → zero or more import entries */
export function extractEntriesFromMarkdown(
  markdown: string,
  fileName: string,
): ResearchImportEntry[] {
  const entries: ResearchImportEntry[] = [];
  const blocks = extractJsonBlocks(markdown);

  for (const block of blocks) {
    const wa = pickWeightAdjustments(block);
    const minDir = pickMinDirectional(block);
    const rules =
      block && typeof block === "object" && Array.isArray((block as { rules?: unknown }).rules)
        ? ((block as { rules: ResearchImportEntry["rules"] }).rules ?? undefined)
        : undefined;
    if (wa || minDir || rules) {
      entries.push({
        source: "manual",
        importedAt: new Date().toISOString().slice(0, 10),
        query: fileName,
        weightAdjustments: wa,
        minDirectionalHitTarget: minDir,
        rules,
        notes: `Extracted JSON block from ${fileName}`,
      });
    }
  }

  const inline = extractInlineWeights(markdown);
  if (Object.keys(inline).length >= 2) {
    entries.push({
      source: "manual",
      importedAt: new Date().toISOString().slice(0, 10),
      query: fileName,
      weightAdjustments: inline,
      notes: `Inline strategy weights parsed from ${fileName}`,
    });
  }

  const hitMatch = markdown.match(
    /directional[^\d]{0,40}([0-9]{2,3})\s*%|hit[^\d]{0,30}([0-9]\.[0-9]{2,3})/i,
  );
  if (entries.length === 0 && hitMatch) {
    const pct = hitMatch[1] ? Number(hitMatch[1]) / 100 : Number(hitMatch[2]);
    if (pct > 0.4 && pct < 0.95) {
      entries.push({
        source: "manual",
        query: fileName,
        minDirectionalHitTarget: pct,
        notes: `Hit-rate target mention in ${fileName} (no weights found)`,
      });
    }
  }

  return entries;
}

export function mergeImportEntries(
  lists: ResearchImportEntry[],
): ResearchImportEntry[] {
  const byKey = new Map<string, ResearchImportEntry>();

  for (const e of lists) {
    const key = e.query ?? e.importedAt ?? "x";
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...e });
      continue;
    }
    const wa = { ...prev.weightAdjustments, ...e.weightAdjustments };
    byKey.set(key, {
      ...prev,
      ...e,
      weightAdjustments: Object.keys(wa).length ? wa : undefined,
      minDirectionalHitTarget:
        e.minDirectionalHitTarget ?? prev.minDirectionalHitTarget,
    });
  }

  return [...byKey.values()];
}
