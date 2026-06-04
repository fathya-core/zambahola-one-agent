import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const knowledgeRoot = join(dirname(fileURLToPath(import.meta.url)));

export async function loadKnowledgeIndex(): Promise<unknown> {
  const raw = await readFile(join(knowledgeRoot, "INDEX.json"), "utf8");
  return JSON.parse(raw);
}

export async function loadStrategyDoc(strategyId: string): Promise<string | null> {
  const map: Record<string, string> = {
    momentum: "momentum.md",
    mean_reversion: "mean-reversion.md",
    rsi: "rsi.md",
    ema_cross: "ema-cross.md",
    volatility_regime: "volatility.md",
    bollinger: "bollinger.md",
  };
  const file = map[strategyId];
  if (!file) return null;
  return readFile(join(knowledgeRoot, "strategies", file), "utf8");
}
