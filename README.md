# ZAMBAHOLA ONE AGENT v0.2

Self-learning **local paper-trading agent** for BTCUSDT. Tick-driven hybrid
engine (`hybrid_v7`): 17 rule strategies + online ML/MLP/GBM + LOB proxy, gated
by regime/accuracy/meta filters, executed on a **paper broker** and continuously
trained from horizon evaluations. Live dashboard on **:8787**. **Paper mode by
default — real exchange keys are opt-in and gated.**

Goal: reach a directional hit rate ≥ ~58% before enabling any real keys.

> Operational runbook (feeds, phase5 automation, Windows/OMAR-PC): see
> [AGENTS.md](AGENTS.md). Full command reference: [docs/COMMANDS.md](docs/COMMANDS.md).
> Architecture & next steps: [docs/ROADMAP.md](docs/ROADMAP.md).
>
> **ZAMBAHOLA BETA** ([zambahola-beta/](zambahola-beta/README.md)) is the new
> offline, validated ML core (Python): data -> features -> labels -> model
> (purged walk-forward) -> cost-aware backtest, with an honest
> "edge-after-costs" verdict before any real trading.

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

## Maximum accuracy (home PC — full Binance power)

```bash
npm run agent:max-accuracy        # full train (30+25+25 cycles, 10k bars)
npm run agent:max-accuracy:start  # live paper + hybrid_v7_max
```

Arabic guide: `docs/ar/أقصى-دقة-على-جهازك.md` · Config: `config/max-accuracy.env`

## Run

```bash
npm run agent:start
```

(Or `pnpm agent:start` if you use pnpm directly.)

Opens the dashboard at **http://localhost:8787** (paper mode by default).  
**Default feed:** `universal` = Binance + order book + Bybit failover (`ZAMBAHOLA_FEED=mock` for offline).

Most-used commands (full list in [docs/COMMANDS.md](docs/COMMANDS.md)):

| Command | Description |
|---------|-------------|
| `npm run agent:status` | JSON status (pid, ticks, port) |
| `npm run agent:stop` | Stop background agent |
| `npm run agent:test-run` | Headless 65s run; requires ≥60 predictions |
| `npm run agent:phase5-auto` | OMAR-PC one-window day-live + overnight train |
| `npm run agent:max-accuracy` | **Max hit-rate** train profile (`config/max-accuracy.env`) |
| `npm run agent:max-accuracy:start` | Live agent with max-accuracy env |
| `npm run agent:ultra-learn` | 30 cycles + 5000-bar train (full pipeline) |
| `npm run agent:patterns` | Arabic pattern journal |

Fast ticks: `ZAMBAHOLA_FAST=1 npm run agent:start`

## What it does

Each tick:

1. Reads **BTCUSDT** price from the configured feed (universal / binance / mock / …)
2. Runs **17 strategies + ensemble + ML/MLP/GBM + LOB proxy**, gated by regime/accuracy/meta filters
3. Emits prediction: **up** / **down** / **range** (default horizon ~30s)
4. Emits decision: **paper_long** / **paper_short** / **no_trade** / **paper_close**
5. Executes **paper trades** (real exchange orders only when explicitly enabled)
6. After the horizon, evaluates **prediction_hit** and **trains the models online**

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

## Validation & quality

```bash
npm run setup
npm run lint         # ESLint (apps/one-agent/src)
npm run typecheck    # tsc --noEmit
npm run test         # Vitest unit tests
npm run agent:test-run   # headless 65s, ≥60 predictions
npm run verify       # full verification → docs/VERIFICATION_REPORT.json
```

CI runs lint + typecheck + test + test-run on every push (`.github/workflows/verify.yml`).

## License

MIT (placeholder — confirm with repo owner)
