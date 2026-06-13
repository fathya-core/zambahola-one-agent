# scripts/ registry

Automation grouped into folders by purpose. Most are invoked via
`npm run agent:*` from the repo root (see [docs/COMMANDS.md](../docs/COMMANDS.md)).

```
scripts/
  core/      run-env.mjs, setup.mjs, time-local.mjs, lib/{run-npm,safe-fetch}.mjs
  verify/    verify-all.mjs
  phase5/    phase5-* (overnight Windows automation)
  train/     training pipelines + overnight learn
  ops/       bridge, telemetry, guard, monitoring, remote
  windows/   one-off Windows bootstrap helpers
```

## core/ — shared infrastructure

| Script | npm command | Purpose |
|--------|-------------|---------|
| `core/setup.mjs` | `npm run setup` | Corepack + `pnpm install` |
| `core/run-env.mjs` | (used by many) | Load a `.env` file / inline vars then spawn a child command |
| `core/lib/run-npm.mjs` | (internal) | Windows-safe npm wrapper |
| `core/lib/safe-fetch.mjs` | (internal) | Shared fetch helper |
| `core/time-local.mjs` | (internal) | Local timestamp formatting |

## verify/

| Script | npm command | Purpose |
|--------|-------------|---------|
| `verify/verify-all.mjs` | `npm run verify` | Full verification → `docs/VERIFICATION_REPORT.json` |

## phase5/ — overnight automation (OMAR-PC Windows)

| Script | npm command | Purpose |
|--------|-------------|---------|
| `phase5/phase5-auto.ps1` | `agent:phase5-auto` | One-window entry: pull → keep-awake → scheduler |
| `phase5/phase5-scheduler.mjs` | `agent:phase5-scheduler` | Day-live + overnight omni-train scheduler |
| `phase5/phase5-agent-start.mjs` | (internal) | Detached agent start |
| `phase5/phase5-agent-stop.mjs` | (internal) | Graceful stop, `taskkill /T /F` fallback |
| `phase5/phase5-agent-watch.mjs` | (internal) | Health watch / restart |
| `phase5/phase5-night-train.mjs` | `agent:phase5-night-now` | Manual night train now |
| `phase5/phase5-mark-night-done.mjs` | `agent:phase5-mark-night-done` | Skip tonight's training |
| `phase5/phase5-reset-night.mjs` | `agent:phase5-reset-night` | Reset night state |
| `phase5/phase5-preflight.mjs` | `agent:phase5-preflight` | Pre-sleep checks |
| `phase5/phase5-night-verify.mjs` | `agent:phase5-night-verify` / `:live-verify` | Post-train / live verify |
| `phase5/phase5-sleep.ps1` | `agent:phase5-sleep` | One-liner before sleep |
| `phase5/phase5-wake-resume.ps1` | `agent:phase5-wake-resume` | Resume after wake |
| `phase5/phase5-live-now.ps1` | `agent:phase5-live-now` | Skip night, start live |
| `phase5/phase5-stable.ps1` | `agent:phase5-stable` | Live-only stable mode |
| `phase5/phase5-stable-stack.mjs` | (internal) | watch + guard sidecars |
| `phase5/phase5-keep-awake.ps1` | (internal) | powercfg + SetThreadExecutionState |
| `phase5/phase5-sanitize-remote.mjs` | `agent:phase5-sanitize-remote` | Purge remote reload/stop commands |
| `phase5/phase5-install-task.ps1` | `agent:phase5-install-task` | Windows scheduled-task installer |

## train/ — training pipelines

| Script | npm command | Purpose |
|--------|-------------|---------|
| `train/max-accuracy-local.mjs` | `agent:max-accuracy[:quick/:start]` | Full max-accuracy orchestrator |
| `train/autonomous-pipeline.mjs` | `agent:auto-pipeline` | learn → deep → mega → ultra → export → verify |
| `train/overnight-learn.ps1` | `agent:overnight-learn` | Phase-2 hybrid overnight |
| `train/overnight-watchdog.mjs` | (internal) | Overnight watchdog |
| `train/dl-nightly.ps1` | `agent:dl-nightly` | DL nightly training |
| `train/path-resume.mjs` | `agent:path-resume` | Live + 5 learn cycles |

## ops/ — bridge / telemetry / guard / monitoring

| Script | npm command | Purpose |
|--------|-------------|---------|
| `ops/local-bridge.mjs` | `agent:local-bridge` | HTTP bridge on :8790 |
| `ops/collect-telemetry.mjs` | (internal) | Snapshot agent/bridge state |
| `ops/push-local-telemetry.mjs` | `agent:push-telemetry` | Collect + git commit/push (Node) |
| `ops/push-telemetry.ps1` | `agent:push-telemetry:ps1` | Collect + git push (PowerShell) |
| `ops/push-local-telemetry.ps1` | (manual) | Git push only |
| `ops/tunnel-bridge.mjs` | `agent:tunnel-bridge` | ngrok tunnel |
| `ops/remote-command-watcher.mjs` | `agent:remote-watcher` | Poll `REMOTE-COMMANDS.json` |
| `ops/live-stack.mjs` | `agent:live-stack` | bridge + watcher + guard |
| `ops/agent-guard.mjs` | `agent:guard` | Guard process |
| `ops/guard-rules.mjs` | (internal) | Guard rule definitions |
| `ops/health-check.mjs` | `agent:health-check` | Health probe |
| `ops/upload-bundle-to-cloud.ps1` | (manual) | Upload report bundles |
| `ops/collect-downloads-reports.ps1` | (manual) | Bundle local reports for AI review |

## windows/ — one-off bootstrap

| Script | npm command | Purpose |
|--------|-------------|---------|
| `windows/phase3-boot.ps1` | `agent:phase3-boot` | Import research + start phase3 |
| `windows/restart-directional.ps1` | (manual) | Stop + import + phase2-live |
| `windows/install-local-stack.ps1` | (manual) | MCP + local stack setup |
| `windows/install-cursor-marketplace.ps1` | (manual) | Marketplace plugin installer |
| `windows/fix-git-push.ps1` | `agent:fix-git-push` | Git push troubleshooting |

## Conventions for new scripts

- Resolve repo root with `join(dirname(fileURLToPath(import.meta.url)), "../..")`
  (scripts now live two levels under the repo root).
- Import shared helpers from `../core/lib/...` and `../core/time-local.mjs`.
- Wire the command in the root `package.json` and document it in `docs/COMMANDS.md`.
