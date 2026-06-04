/**
 * Public derivatives microstructure — no API keys.
 */

export interface MarketSignals {
  fundingRate: number;
  markPrice: number;
  indexPrice: number;
  premiumPct: number;
  longShortRatio: number;
  openInterest?: number;
  openInterestChange?: number;
  updatedAt: number;
}

let signals: MarketSignals = {
  fundingRate: 0,
  markPrice: 0,
  indexPrice: 0,
  premiumPct: 0,
  longShortRatio: 1,
  openInterest: undefined,
  openInterestChange: undefined,
  updatedAt: 0,
};

let lastOi: number | undefined;

export function getMarketSignals(): MarketSignals {
  return signals;
}

export async function refreshMarketSignals(): Promise<MarketSignals> {
  let fundingRate = 0;
  let markPrice = 0;
  let indexPrice = 0;
  let longShortRatio = 1;

  try {
    const res = await fetch(
      "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT",
      { signal: AbortSignal.timeout(8000) },
    );
    const data = (await res.json()) as {
      lastFundingRate?: string;
      markPrice?: string;
      indexPrice?: string;
    };
    fundingRate = Number(data.lastFundingRate ?? 0);
    markPrice = Number(data.markPrice ?? 0);
    indexPrice = Number(data.indexPrice ?? 0);
  } catch {
    /* */
  }

  try {
    const res = await fetch(
      "https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1",
      { signal: AbortSignal.timeout(8000) },
    );
    const arr = (await res.json()) as Array<{ longShortRatio?: string }>;
    longShortRatio = Number(arr[0]?.longShortRatio ?? 1);
  } catch {
    /* */
  }

  const premiumPct =
    indexPrice > 0 ? ((markPrice - indexPrice) / indexPrice) * 100 : 0;

  let openInterest: number | undefined;
  let openInterestChange: number | undefined;
  try {
    const res = await fetch(
      "https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT",
      { signal: AbortSignal.timeout(8000) },
    );
    const data = (await res.json()) as { openInterest?: string };
    openInterest = Number(data.openInterest);
    if (lastOi && lastOi > 0) {
      openInterestChange = (openInterest - lastOi) / lastOi;
    }
    lastOi = openInterest;
  } catch {
    /* */
  }

  signals = {
    fundingRate,
    markPrice,
    indexPrice,
    premiumPct: Number(premiumPct.toFixed(6)),
    longShortRatio,
    openInterest,
    openInterestChange,
    updatedAt: Date.now(),
  };
  return signals;
}

export function startMarketSignalsLoop(intervalMs = 60_000): () => void {
  void refreshMarketSignals();
  const t = setInterval(() => void refreshMarketSignals(), intervalMs);
  return () => clearInterval(t);
}

/** Normalized -1..1 for ML */
export function signalsToFeatures(s: MarketSignals): {
  fundingNorm: number;
  premiumNorm: number;
  longShortNorm: number;
} {
  return {
    fundingNorm: Math.max(-1, Math.min(1, s.fundingRate * 800)),
    premiumNorm: Math.max(-1, Math.min(1, s.premiumPct * 20)),
    longShortNorm: Math.max(-1, Math.min(1, (s.longShortRatio - 1) * 2)),
  };
}
