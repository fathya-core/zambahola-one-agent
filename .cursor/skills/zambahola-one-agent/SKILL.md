---
name: zambahola-one-agent
description: Operate ZAMBAHOLA ONE AGENT — phase2-live, bridge telemetry, Arabic analyst, directional metrics, MCP/Zapier/HF integrations. Use for agent:start, health-check, push-telemetry, Binance readiness, or reading LOCAL-TELEMETRY.json.
---

# ZAMBAHOLA ONE AGENT

## Live stack (Windows — 4 terminals)

```powershell
npm run agent:phase2-live      # :8787 horizon 45s
npm run agent:local-bridge     # :8790
npm run agent:push-telemetry   # git sync to cloud
npm run agent:remote-watcher   # cloud commands
```

Verify: `npm run agent:health-check` → horizon **45s**, hostname **OMAR-PC**, feed **fast_tick**.

## MCP tools (local)

| Tool | Purpose |
|------|---------|
| `zambahola_get_telemetry` | Full snapshot |
| `zambahola_get_analyst` | Arabic why abstain/signal |
| `zambahola_get_patterns` | Regime × strategy journal |
| `zambahola_queue_command` | Remote npm actions |

## Success metrics (pre-Binance)

| Metric | Target |
|--------|--------|
| Horizon | 45s |
| Directional hit | ≥ 58–62% |
| Abstain | 40–75% (not 95%+) |
| Directional signals | > 0 |

## Research import (no backtest)

```powershell
npm run agent:research-import -- apps/one-agent/knowledge/user-reports/AGENT-IMPORT-FINAL.json
npm run agent:import-hf-research
```

## Docs

- Arabic bridge: `docs/ar/ربط-الجهاز-المحلي.md`
- Marketplace: `docs/ar/تثبيت-اضافات-السوق.md`
- Integrations: `docs/INTEGRATIONS.md`
