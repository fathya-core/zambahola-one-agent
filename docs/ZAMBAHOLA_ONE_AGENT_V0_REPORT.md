# ZAMBAHOLA ONE AGENT v0 — Technical Report

## Overview

v0 is a **standalone local trading agent** that runs on the developer machine. It uses a **mock BTCUSDT feed** (1 Hz), produces **up/down/range** predictions with a **30s horizon**, makes **paper-only** decisions, and serves a **minimal dashboard** on port **8787**.

No real exchange connectivity, keys, or live order execution.

## Architecture

```
MockMarketFeed (1s)
       ↓
PredictionEngine → DecisionEngine → PaperBroker
       ↓                ↓
   Evaluator (30s horizon, prediction_hit)
       ↓
   Storage (jsonl + metrics + receipts)
       ↓
   HTTP Server :8787 → Dashboard (static)
```

### Modules

| Path | Responsibility |
|------|----------------|
| `market-feed/` | `MarketFeed` interface + `MockMarketFeed` |
| `prediction-engine/` | Momentum heuristic → up/down/range + confidence |
| `decision-engine/` | paper_long / paper_short / no_trade / paper_close |
| `paper-broker/` | Open/close paper positions, PnL, drawdown |
| `evaluator/` | `prediction_hit` after horizon |
| `storage/` | `latest.jsonl`, ledger, metrics, receipts |
| `server/` | REST API + static dashboard |
| `dashboard/` | Lightweight HTML/JS UI |
| `sdk/` | `createZambaholaAgent()` |
| `mcp/` | MCP tool name/schema scaffold |

### Swapping the feed

Implement `MarketFeed` in `market-feed/types.ts` and inject via `AgentCore({ feed: new BinanceWsFeed() })`. Engines stay unchanged.

## Commands

```bash
pnpm install
pnpm agent:start
pnpm agent:status
pnpm agent:stop
pnpm agent:test-run
```

## Data contract

- `apps/one-agent/data/runs/latest.jsonl` — typed records: tick, prediction, decision, trade, evaluation, metric
- `apps/one-agent/data/trades/paper-ledger.jsonl` — trades and decision events
- `apps/one-agent/data/metrics/current.json` — hit rate, paper PnL, calibration, drawdown, etc.
- `apps/one-agent/data/receipts/` — per-evaluation and lifecycle JSON files

## Metrics (v0)

| Metric | Description |
|--------|-------------|
| hitRate | Fraction of evaluated predictions marked `predictionHit` |
| paperPnl | Realized + mark-to-market paper PnL |
| averageWin / averageLoss | Mean closed trade PnL |
| falsePositiveRate | Miss rate on evaluated predictions (v0 proxy) |
| confidenceCalibration | `1 - abs(0.65 - hitRate)` heuristic |
| maxDrawdown | Peak-to-trough on closed-trade equity |

## Validation performed

| Check | Expected |
|-------|----------|
| `pnpm install` | Clean install |
| `pnpm agent:test-run` | ≥60 predictions in 65s |
| `pnpm agent:start` | HTTP 200 on dashboard and `/api/status` |
| Ledger | Non-empty `paper-ledger.jsonl` when trades fire |
| Safety | No real trade code paths |

## Known limitations

1. **Mock feed only** — prices are synthetic random walk.
2. **Simple prediction model** — 5-tick momentum heuristic, not ML.
3. **MCP scaffold** — tools document CLI/file access; no hosted MCP server in-repo.
4. **Detached start** — uses pid file; if process crashes, stale pid may need manual cleanup.
5. **Browser open** — may not work in headless CI/Cloud VMs.
6. **Single symbol** — BTCUSDT hardcoded in mock feed.

## Next steps

1. `BinanceMarketFeed` / `BybitMarketFeed` implementing `MarketFeed`
2. Pluggable prediction model + backtest mode
3. Hosted MCP server wiring `handleMcpTool`
4. Persistent run history rotation
5. WebSocket push to dashboard (replace 1s polling)

## Security

- No `.env` secrets in v0
- No signed exchange requests
- Paper broker cannot place real orders
