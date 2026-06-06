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
