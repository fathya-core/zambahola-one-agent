# zambahola-one-agent

**ZAMBAHOLA ONE AGENT v0** — local paper-trading agent (`apps/one-agent`).

## Commands (from repo root)

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install workspace dependencies |
| `pnpm agent:start` | Start agent + dashboard (background), open browser |
| `pnpm agent:status` | Check pid / running state |
| `pnpm agent:stop` | Stop background agent |
| `pnpm agent:test-run` | Headless 65s run; exit 1 if &lt;60 predictions |

## Services

| Service | Required | Port | Notes |
|---------|----------|------|-------|
| One Agent HTTP + dashboard | **Yes** (when running) | **8787** | `http://127.0.0.1:8787` |

No database, Docker, or external APIs in v0.

## Environment

- No secrets or exchange keys in v0.
- Optional: `ZAMBAHOLA_RESET=1` clears run/ledger files on next agent start (test-run sets this).

## Cursor Cloud specific instructions

### VM update script

```bash
pnpm install
```

### Start / stop

```bash
pnpm agent:start    # detached process; pid in apps/one-agent/data/agent.pid
pnpm agent:status
pnpm agent:stop
```

In headless VMs, browser open may fail — use `curl http://127.0.0.1:8787/api/status` or visit the Desktop pane.

### Validation checklist

1. `pnpm install` succeeds
2. `pnpm agent:test-run` → `ok: true`, `predictionCount >= 60`
3. `pnpm agent:start` → dashboard responds on port 8787
4. Confirm `apps/one-agent/data/metrics/current.json` updates
5. Confirm `paper-ledger.jsonl` has decision/trade lines
6. `pnpm agent:stop`

### Architecture notes

- **Market feed**: `MockMarketFeed` implements `MarketFeed` — replace with Binance/Bybit websocket adapter without changing engines.
- **Trading**: paper only via `PaperBroker`.
- **MCP**: scaffold in `apps/one-agent/src/mcp/` (tools delegate to CLI/files in v0).

Do **not** put `pnpm agent:start` in the VM update script.
