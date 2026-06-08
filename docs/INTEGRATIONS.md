# ZAMBAHOLA Integrations

## Local ↔ Cloud

| Channel | Command | Data path |
|---------|---------|-----------|
| Git telemetry | `npm run agent:push-telemetry` | `apps/one-agent/data/bridge/LOCAL-TELEMETRY.json` |
| Local bridge HTTP | `npm run agent:local-bridge` | `:8790/telemetry` |
| MCP (Cursor desktop) | `mcp-servers/zambahola-local/server.mjs` | stdio tools |
| Remote commands | `npm run agent:remote-watcher` | `REMOTE-COMMANDS.json` |
| ngrok (optional) | `npm run agent:tunnel-bridge` | public URL |

Arabic guide: `docs/ar/ربط-الجهاز-المحلي.md`

## Zapier MCP (user account)

Enabled in this workspace session:
- GitHub (create/update files, issues, PRs)
- Gmail, Outlook, ChatGPT, Apify
- Google Sheets, Slack (enable auth in Cursor MCP settings)

Suggested automations:
1. **Sheets row** on each `push-telemetry` (directional hit, abstain)
2. **Slack alert** when directional hit ≥ 58%
3. **GitHub issue** when cloud agent detects regression

## Hugging Face

Research import: `apps/one-agent/knowledge/hf-research-import.json`

```bash
npm run agent:research-import -- apps/one-agent/knowledge/hf-research-import.json
```

Papers referenced: DeepLOB (1808.03668), TLOB (2502.15757), order flow CNN (2304.02472).

## Cursor Cloud Agent

Reads local state via:
1. User runs `agent:push-telemetry` → cloud `git pull`
2. File `LOCAL-TELEMETRY.json` in repo

Do not put bridge tokens in committed files — use `config/bridge.env` (gitignored).

## Skills & MCP catalog

Full index (Arabic + JSON):

- `docs/ar/المهارات-والروابط.md`
- `apps/one-agent/knowledge/SKILLS-AND-LINKS.json`

```bash
npm run agent:research-import -- apps/one-agent/knowledge/SKILLS-AND-LINKS.json
```

### Cursor Marketplace plugins

| Plugin | Skills |
|--------|--------|
| tavily | tavily-search, tavily-research, tavily-extract, tavily-crawl |
| zapier | zapier-setup, zapier-status, create-my-tools-profile |
| huggingface-skills | hf-cli, hugging-face-model-trainer, hugging-face-jobs, … |
| cli-for-agent | cli-for-agents |
| cursor-sdk | cursor-sdk |
| agent-compatibility | check-agent-compatibility |
| continual-learning | continual-learning |

Install: `docs/ar/تثبيت-اضافات-السوق.md` or `scripts/install-cursor-marketplace.ps1`

### Log reviewer (second agent)

```bash
npm run agent:log-review          # dry-run
npm run agent:log-review:apply    # cleanup weights, receipts, NaN ML
```

See `docs/ar/مراجع-السجل.md`. Overnight: `ZAMBAHOLA_OVERNIGHT_AUDIT_MIN=60` with `agent:overnight-learn`.
