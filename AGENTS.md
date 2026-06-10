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

### Geo-blocked exchanges (common in cloud VMs)

Binance/Bybit REST may return **restricted location**. Use:

- `ZAMBAHOLA_FEED=coingecko` for live BTC price (no keys)
- `ZAMBAHOLA_FEED=mock` for headless CI
- Train pipelines work via `synthetic_fallback` / Bybit when allowed (no backtest CLI)

Default `universal` is best on home networks without geo-block.

### Full verification (preferred over manual checklist)

```bash
npm run verify
```

Writes `docs/VERIFICATION_REPORT.json` (setup, 17 strategies, test-run, mega-train, required files).

### Start / stop

```bash
npm run agent:start
npm run agent:status
npm run agent:stop
```

### OMAR-PC Windows (primary machine — always assume win32)

- **Path:** `C:\Users\pc\zambahola-one-agent` · **Shell:** PowerShell 7.
- **One window:** `npm run agent:phase5-auto` (`.ps1` → `phase5-scheduler.mjs`). Do not close; minimize only.
- **npm on Windows:** all `scripts/lib/run-npm.mjs` calls use `cmd.exe /d /s /c npm …` (direct `npm.cmd` spawn → `EINVAL`).
- **Agent start:** `agent:phase5-ready` returns to prompt immediately — agent runs detached (`start.ts`). Check with `curl http://127.0.0.1:8787/api/status`.
- **Agent stop (night train):** `phase5-agent-stop.mjs` uses `taskkill /PID /T /F` when graceful stop fails.
- **Night train:** `agent:phase5-night-now` — stable profile in `config/phase5-night-train.env`; fallback to `omni-train:quick` on crash; always restarts agent at end.
- **After manual night train:** `npm run agent:phase5-mark-night-done` then restart `agent:phase5-auto`.
- **Post-night auto-test:** end of `phase5-night-train` runs `agent:phase5-night-verify` (agent up, ticks moving, fresh export, push telemetry). Report: `PHASE5-NIGHT-VERIFY.json`.
- **Sleep one-liner (Windows):** `npm run agent:phase5-sleep` — pull → reset night → **keep-awake** (powercfg AC+DC + `SetThreadExecutionState`) → preflight → auto. **After PC slept/wake:** `npm run agent:phase5-wake-resume`. Plug laptop to AC; set Windows Sleep=Never if needed.
- **Plug laptop to AC**; overnight script disables sleep on AC via `powercfg`.

Headless: `curl http://127.0.0.1:8787/api/status`. Engine id in metrics: `hybrid_v6_ultra`.

### Git hygiene

`apps/one-agent/knowledge/research-log.jsonl` is runtime-only (ignored after `!apps/one-agent/knowledge/**/*` negation — ignore rule must come **after** that line in `.gitignore`).

Do **not** put `npm run agent:start` or `npm run verify` in the VM update script.

### Hit rate / training (cloud)

- Guard uses **directional** rolling by default (`ZAMBAHOLA_GUARD_METRIC=directional`).
- Full pre-Binance pipeline: `npm run agent:omni-train:quick` (CI) or `agent:omni-train` (long).
- Phase 2 live profile: `npm run agent:phase2-live` (`config/phase2-live.env` — micro gates, meta-PnL, analyst AR).
- Threshold sweeps (internal replay, not user backtest): `npm run agent:experiments:quick` or `agent:experiments`.
- **Local PC bridge:** `agent:local-bridge` (:8790) + `agent:push-telemetry` → `apps/one-agent/data/bridge/LOCAL-TELEMETRY.json` for cloud visibility.
- MCP local server: `mcp-servers/zambahola-local/server.mjs` — see `.cursor/mcp.json.example`.
- Arabic: `docs/ar/ربط-الجهاز-المحلي.md` · `docs/ar/تثبيت-اضافات-السوق.md` · `docs/ar/المهارات-والروابط.md` · `docs/INTEGRATIONS.md`.
- **Skills/MCP index:** `apps/one-agent/knowledge/SKILLS-AND-LINKS.json` — import via `agent:research-import`.
- Cursor Marketplace (user desktop): `tavily` · `zapier` · `huggingface-skills` · `cli-for-agent` · `cursor-sdk` · `agent-compatibility` · `continual-learning` — see `scripts/install-cursor-marketplace.ps1`.
- Project skill: `.cursor/skills/zambahola-one-agent/SKILL.md`.
- Log reviewer: `npm run agent:log-review` / `agent:log-review:apply` — `docs/ar/مراجع-السجل.md`.
- **Dual agents (dashboard):** section «الوكيلان» on `:8787` shows session-scoped counters (`sessionEvaluations`, `sessionLogAudits`, `sessionSkillApplies`). Counters reset on each `agent.start()`. Log audit + analyst run **in background** (non-blocking) off session evals. Persisted skills: `data/learning/last-skill-applied.json`. APIs: `/api/learning` (`dualAgent`), `/api/log-audit` (`report` + `dualAgent`), `/api/analyst` (`skillAppliedAr`).
- **Latent S-tier consensus:** when ensemble=`range` but ≥2 S-tier votes skew up/down, `latent-consensus.ts` promotes directional signal before gates (`ZAMBAHOLA_LATENT_MIN_S_VOTES`, `ZAMBAHOLA_HIT_RECOVER_S_LEAN`). Phase4 profile: `config/phase4-hit-recover.env`.
- **Expert lean 2 models:** `ZAMBAHOLA_EXPERT_LEAN_MIN_MODELS=2` + `MIN_MODEL_VOTERS=2` — restart agent loads ML/weights/patterns from disk (no reset). Skip reason in meta: `expertLeanSkip`.
- **Phase 5 auto (OMAR-PC):** `npm run agent:phase5-auto` — one window only (close old phase4/live-stack windows). Day live (06–20 Riyadh) + **full night** (20–06): continuous `agent:omni-train:night` cycles until ~30m before 06:00, then agent up + push/audit. Friday first cycle = full `agent:omni-train`. Not the old 10m `omni-train:quick`. Logs: `PHASE5-SCHEDULER.jsonl`. Missed night: `agent:phase5-night-now`. After manual train: `agent:phase5-mark-night-done`. DL live: `ZAMBAHOLA_DL_LIVE_AUTO=1`.
- **Live follow + auto-fix (OMAR-PC):** `npm run agent:live-stack` (bridge + watcher + guard). In-agent: `agent-self-guard.ts` every 120 ticks. Guard report: `data/bridge/GUARD-REPORT.json`. Cloud reads telemetry after `agent:push-telemetry:ps1` — cannot attach to PC without bridge/git push.
- Research paste: `npm run agent:research-import -- apps/one-agent/knowledge/research-imports.example.json`
