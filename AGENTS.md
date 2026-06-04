# zambahola-one-agent

**ZAMBAHOLA ONE AGENT v0.2** — hybrid ML + Binance + sentiment (`apps/one-agent`).

## Commands (from repo root)

| Command | Purpose |
|---------|---------|
| `npm run setup` | Enable Corepack + `pnpm install` (no global pnpm required) |
| `npm run agent:start` | Start agent + dashboard (background), open browser |
| `npm run agent:status` | Check pid / running state |
| `npm run agent:stop` | Stop background agent |
| `npm run agent:test-run` | Headless 65s run; exit 1 if &lt;60 predictions |

## Services

| Service | Required | Port | Notes |
|---------|----------|------|-------|
| One Agent HTTP + dashboard | **Yes** (when running) | **8787** | `http://127.0.0.1:8787` |

No database, Docker, or external APIs in v0.

## Environment

- No secrets or exchange keys in v0.
- `ZAMBAHOLA_FEED=binance|mock|binance_rest` (default `binance` hybrid)
- `ZAMBAHOLA_LEARN_CYCLES=N` for extended training
- Optional: `ZAMBAHOLA_RESET=1` clears run/ledger files on next agent start (test-run sets this).

## Cursor Cloud specific instructions

### VM update script

```bash
npm run setup
```

### Start / stop

```bash
npm run agent:start    # detached process; pid in apps/one-agent/data/agent.pid
npm run agent:status
npm run agent:stop
```

In headless VMs, browser open may fail — use `curl http://127.0.0.1:8787/api/status` or visit the Desktop pane.

### Validation checklist

1. `npm run setup` succeeds
2. `npm run agent:test-run` → `ok: true`, `predictionCount >= 60`
3. `npm run agent:start` → dashboard responds on port 8787
4. Confirm `apps/one-agent/data/metrics/current.json` updates
5. Confirm `paper-ledger.jsonl` has decision/trade lines
6. `npm run agent:stop`

### Architecture notes

- **Market feed**: `MockMarketFeed` implements `MarketFeed` — replace with Binance/Bybit websocket adapter without changing engines.
- **Trading**: paper only via `PaperBroker`.
- **MCP**: scaffold in `apps/one-agent/src/mcp/` (tools delegate to CLI/files in v0).

Do **not** put `npm run agent:start` in the VM update script.
