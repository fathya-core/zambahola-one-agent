# ZAMBAHOLA ONE AGENT v0

Standalone **local paper-trading agent** for BTCUSDT. Mock market feed in v0 (Binance/Bybit websocket-ready architecture). **No real trades. No API keys.**

## Requirements

- **Node.js 20+** only (includes `npm` and **Corepack** — you do **not** need to install pnpm yourself)

## Setup

```bash
git clone https://github.com/fathya-core/zambahola-one-agent.git
cd zambahola-one-agent
npm run setup
```

`npm run setup` installs dependencies using the pinned pnpm version (via Corepack or `npx` — **no separate pnpm install**).

If you already use pnpm globally:

```bash
pnpm install
```

## Run

```bash
npm run agent:start
```

(Or `pnpm agent:start` if you use pnpm directly.)

Opens the dashboard at **http://localhost:8787** (paper mode only).  
**Default feed:** live Binance BTCUSDT (`ZAMBAHOLA_FEED=mock` for offline/sim).

Other commands:

| Command | Description |
|---------|-------------|
| `npm run agent:status` | JSON status (pid, ticks, port) |
| `npm run agent:stop` | Stop background agent |
| `npm run agent:test-run` | Headless 65s run; requires ≥60 predictions |
| `npm run agent:learn` | 5 learning cycles — ML + strategy weights |
| `npm run agent:turbo-learn` | Fast learn on mock feed |

## What v0 does

Every **1 second**:

1. Reads **BTCUSDT** price from the **mock feed**
2. Emits prediction: **up** / **down** / **range** (default horizon **30s**)
3. Emits decision: **paper_long** / **paper_short** / **no_trade** / **paper_close**
4. Executes **paper trades** only
5. After horizon, evaluates **prediction_hit** and updates metrics

## Data outputs

| Path | Content |
|------|---------|
| `apps/one-agent/data/runs/latest.jsonl` | Every tick, prediction, decision, trade, metric |
| `apps/one-agent/data/trades/paper-ledger.jsonl` | Paper decisions and trades |
| `apps/one-agent/data/metrics/current.json` | Live metrics snapshot |
| `apps/one-agent/data/receipts/` | Evaluation and lifecycle receipts |

## Project layout

```
apps/one-agent/src/
  market-feed/      # Mock feed (swap for Binance/Bybit later)
  prediction-engine/
  decision-engine/
  paper-broker/
  evaluator/
  server/           # HTTP API + dashboard host
  dashboard/        # Minimal local UI
  storage/
  sdk/              # createZambaholaAgent()
  mcp/              # MCP tool scaffold
```

## SDK (programmatic)

```typescript
import { createZambaholaAgent } from "@zambahola/one-agent/sdk";

const agent = createZambaholaAgent();
await agent.start();
const metrics = await agent.getMetrics();
await agent.stop();
```

## MCP tools (scaffold)

- `trading.startPaperRun`
- `trading.stopRun`
- `trading.getStatus`
- `trading.getLatestPrediction`
- `trading.getMetrics`
- `trading.getPaperTrades`

See `apps/one-agent/src/mcp/index.ts`.

## Validation

```bash
npm run setup
npm run agent:test-run   # ≥60 predictions
npm run agent:start      # dashboard at :8787
```

## License

MIT (placeholder — confirm with repo owner)
