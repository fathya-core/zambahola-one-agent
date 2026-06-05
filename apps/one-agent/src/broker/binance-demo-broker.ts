import type { Decision, MarketTick, PaperTrade } from "../types.js";
import type { TradeBroker } from "./types.js";
import { PaperBroker } from "../paper-broker/index.js";
import { binanceSignedPost } from "../exchange/binance-sign.js";
import { appendTradeLedger } from "../storage/index.js";

/**
 * Paper PnL + optional Binance Futures **testnet** orders.
 * Keys only via env — never commit secrets.
 */
export class BinanceDemoBroker implements TradeBroker {
  readonly mode: string;
  private paper = new PaperBroker();
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly symbol: string;
  private readonly qty: number;
  private readonly sendOrders: boolean;

  constructor(mode: "binance_demo" | "binance_live") {
    this.mode = mode;
    this.apiKey = process.env.BINANCE_API_KEY ?? "";
    this.apiSecret = process.env.BINANCE_API_SECRET ?? "";
    this.symbol = process.env.ZAMBAHOLA_SYMBOL ?? "BTCUSDT";
    this.qty = Number(process.env.ZAMBAHOLA_ORDER_QTY ?? 0.001);
    this.sendOrders =
      Boolean(this.apiKey && this.apiSecret) &&
      (mode === "binance_demo" ||
        (mode === "binance_live" && process.env.ZAMBAHOLA_I_ACCEPT_REAL_TRADING === "RISK"));

    if (!this.sendOrders) {
      console.warn(
        `[zambahola] ${mode}: no API keys or confirm flag — tracking paper only`,
      );
    } else if (mode === "binance_live") {
      console.warn("[zambahola] LIVE TRADING ENABLED — real funds at risk");
    }
  }

  getPosition() {
    return this.paper.getPosition();
  }
  getOpenTrade() {
    return this.paper.getOpenTrade();
  }
  getClosedTrades() {
    return this.paper.getClosedTrades();
  }
  getAllTrades() {
    return this.paper.getAllTrades();
  }
  getTotalPnl() {
    return this.paper.getTotalPnl();
  }
  getMaxDrawdown() {
    return this.paper.getMaxDrawdown();
  }
  markToMarket(price: number) {
    this.paper.markToMarket(price);
  }

  execute(decision: Decision, tick: MarketTick): PaperTrade | null {
    const trade = this.paper.execute(decision, tick);
    if (trade && this.sendOrders) {
      void this.placeExchangeOrder(decision, tick);
    }
    return trade;
  }

  private async placeExchangeOrder(
    decision: Decision,
    tick: MarketTick,
  ): Promise<void> {
    try {
      let side: "BUY" | "SELL" | null = null;
      if (decision.action === "paper_long") side = "BUY";
      if (decision.action === "paper_short") side = "SELL";
      if (decision.action === "paper_close") {
        const pos = this.paper.getPosition();
        side = pos === "long" ? "SELL" : pos === "short" ? "BUY" : null;
      }
      if (!side) return;

      const result = await binanceSignedPost(
        "/fapi/v1/order",
        {
          symbol: this.symbol,
          side,
          type: "MARKET",
          quantity: this.qty,
        },
        this.apiKey,
        this.apiSecret,
      );

      await appendTradeLedger({
        event: "exchange_order",
        mode: this.mode,
        orderId: (result as { orderId?: number }).orderId,
        side,
        price: tick.price,
        qty: this.qty,
        decisionId: decision.decisionId,
      });
    } catch (err) {
      await appendTradeLedger({
        event: "exchange_error",
        mode: this.mode,
        error: String(err),
        decisionId: decision.decisionId,
      });
    }
  }
}
