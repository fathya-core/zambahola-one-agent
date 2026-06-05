import type { TradeBroker, BrokerMode } from "./types.js";
import { PaperBroker } from "../paper-broker/index.js";
import { BinanceDemoBroker } from "./binance-demo-broker.js";

export function createBroker(mode?: string): TradeBroker {
  const m = (mode ?? process.env.ZAMBAHOLA_BROKER ?? "paper").toLowerCase() as BrokerMode;

  if (m === "binance_demo") {
    return new BinanceDemoBroker("binance_demo");
  }
  if (m === "binance_live") {
    if (process.env.ZAMBAHOLA_I_ACCEPT_REAL_TRADING !== "RISK") {
      console.error(
        "[zambahola] binance_live blocked. Set ZAMBAHOLA_I_ACCEPT_REAL_TRADING=RISK explicitly.",
      );
      return new PaperBroker();
    }
    return new BinanceDemoBroker("binance_live");
  }
  if (m === "bybit_demo") {
    console.warn("[zambahola] bybit_demo: paper tracking until adapter ships — use paper + bybit feed");
    return new PaperBroker();
  }

  return new PaperBroker();
}

export function getBrokerPhase(): {
  phase: number;
  label: string;
  next: string;
} {
  const m = (process.env.ZAMBAHOLA_BROKER ?? "paper").toLowerCase();
  if (m === "binance_live") {
    return { phase: 4, label: "live", next: "monitor risk limits" };
  }
  if (m === "binance_demo") {
    return { phase: 3, label: "binance_testnet", next: "binance_live after demo stable" };
  }
  return {
    phase: 2,
    label: "paper_learn",
    next: "ZAMBAHOLA_BROKER=binance_demo + testnet API keys",
  };
}
