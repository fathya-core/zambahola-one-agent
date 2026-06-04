const MAX = Number(process.env.ZAMBAHOLA_LOB_DEPTH ?? 128);

const imbalanceSeries: number[] = [];
const spreadSeries: number[] = [];

export function recordLobSnapshot(imbalance: number, spreadBps: number): void {
  imbalanceSeries.push(imbalance);
  spreadSeries.push(spreadBps);
  if (imbalanceSeries.length > MAX) imbalanceSeries.shift();
  if (spreadSeries.length > MAX) spreadSeries.shift();
}

export function getLobSeries(): { imbalance: number[]; spread: number[] } {
  return {
    imbalance: [...imbalanceSeries],
    spread: [...spreadSeries],
  };
}

export function lobSeriesReady(min = 16): boolean {
  return imbalanceSeries.length >= min;
}
