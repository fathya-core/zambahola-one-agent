---
name: zambahola-one-agent
description: Operate ZAMBAHOLA ONE AGENT — phase2-live, bridge telemetry, log reviewer, Arabic analyst, directional metrics, all MCP/Zapier/HF/Tavily skills. Use for agent:start, health-check, push-telemetry, log-review, Binance readiness, or reading LOCAL-TELEMETRY.json.
---

# ZAMBAHOLA ONE AGENT

**Full skills & links index:** `docs/ar/المهارات-والروابط.md` · `apps/one-agent/knowledge/SKILLS-AND-LINKS.json`

## Live stack (Windows — OMAR-PC)

```powershell
npm run agent:phase2-live      # :8787 horizon 45s
npm run agent:local-bridge     # :8790
npm run agent:push-telemetry   # git sync to cloud
npm run agent:remote-watcher   # cloud commands
```

Verify: `npm run agent:health-check` → horizon **45s**, hostname **OMAR-PC**, feed **fast_tick**.

## Dual agents (primary + log reviewer)

**Primary** predicts/trains live. **Log reviewer** audits `latest.jsonl` every `ZAMBAHOLA_LOG_AUDIT_EVERY` (50) evals — reloads weights in-process when cleanup applies.

```powershell
npm run agent:log-review           # manual dry-run
npm run agent:log-review:apply     # manual cleanup
```

MCP: `zambahola_get_log_audit` · `zambahola_run_log_audit` · `zambahola_get_skills?q=...`

Remote: queue `{ "action": "log-review:apply" }` in `REMOTE-COMMANDS.json`.

When issues detected, analyst **applies** skills automatically (`skillAppliedAr` in `/api/analyst`). Disable: `ZAMBAHOLA_ANALYST_AUTO_APPLY=0`. MCP: `zambahola_apply_analyst_skills`.

Reports: `data/learning/LOG-AUDIT-REPORT.json` — `docs/ar/مراجع-السجل.md`

## MCP tools (local — `zambahola-local`)

| Tool | Purpose |
|------|---------|
| `zambahola_get_telemetry` | Full snapshot |
| `zambahola_get_metrics` | Dashboard metrics |
| `zambahola_get_analyst` | Arabic why abstain/signal |
| `zambahola_get_patterns` | Regime × strategy journal |
| `zambahola_queue_command` | Remote npm actions |
| `zambahola_read_telemetry_file` | Offline LOCAL-TELEMETRY.json |

## Cursor Marketplace plugins (install on desktop)

```
/add-plugin tavily
/add-plugin zapier
/add-plugin huggingface-skills
/add-plugin cli-for-agent
/add-plugin cursor-sdk
/add-plugin agent-compatibility
/add-plugin continual-learning
```

| Plugin | Skills / when |
|--------|----------------|
| **tavily** | `tavily-search` · `tavily-research` · `tavily-extract` · `tavily-crawl` |
| **zapier** | `zapier-setup` · `zapier-status` — Slack/Sheets/GitHub |
| **huggingface-skills** | `hf-cli` · `hugging-face-model-trainer` · `paper_search` MCP |
| **cli-for-agent** | Fix `npm run agent:*` for automation |
| **cursor-sdk** | `@cursor/sdk` Cloud Agents |
| **agent-compatibility** | Repo readiness score |
| **continual-learning** | Update AGENTS.md |

Setup: `docs/ar/تثبيت-اضافات-السوق.md` · `.cursor/mcp.json.example`

## Success metrics (pre-Binance)

| Metric | Target |
|--------|--------|
| Horizon | 45s |
| Directional hit | ≥ 58–62% |
| Abstain | 40–75% (not 95%+) |
| Directional signals | > 0 |

## Research import

```powershell
npm run agent:research-import -- apps/one-agent/knowledge/SKILLS-AND-LINKS.json
npm run agent:import-hf-research
```

## Docs (Arabic)

- Skills & links: `docs/ar/المهارات-والروابط.md`
- Bridge: `docs/ar/ربط-الجهاز-المحلي.md`
- MCP/Zapier: `docs/ar/تكاملات-MCP-وزابير.md`
- Log reviewer: `docs/ar/مراجع-السجل.md`
- Integrations (EN): `docs/INTEGRATIONS.md`
