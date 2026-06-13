# Command reference

All commands run from the repo root as `npm run <name>`. Grouped by purpose.
Script-to-file mapping: [scripts/README.md](../scripts/README.md). Profile
mapping: [config/README.md](../config/README.md).

## Quality / tooling

| Command | Purpose |
|---------|---------|
| `setup` | Corepack + `pnpm install` |
| `lint` / `lint:fix` | ESLint over `apps/one-agent/src` |
| `format` / `format:check` | Prettier |
| `typecheck` | `tsc --noEmit` |
| `test` | Vitest unit tests |
| `verify` | Full verification → `docs/VERIFICATION_REPORT.json` |

## Core agent lifecycle

| Command | Purpose |
|---------|---------|
| `agent:start` | Start agent (max-accuracy profile) |
| `agent:status` | pid / running state JSON |
| `agent:stop` | Stop background agent |
| `agent:test-run` | Headless 65s run (≥60 predictions or exit 1) |
| `agent:health-check` | Health probe |

## Runtime profiles

| Command | Profile |
|---------|---------|
| `agent:phase2-live` | `config/phase2-live.env` |
| `agent:phase2-signals` | `config/phase2-signals.env` |
| `agent:phase2-learn-trade` | `config/phase2-learn-trade.env` |
| `agent:phase2-hybrid` | `config/phase2-hybrid.env` |
| `agent:phase3-intensive` | `config/phase3-intensive.env` |
| `agent:phase4-hit-recover` / `agent:phase4-reload` | `config/phase4-hit-recover.env` |
| `agent:phase5-ready` / `agent:phase5-reload` | `config/phase5-ready.env` |
| `agent:max-accuracy[:quick][:start]` | `config/max-accuracy.env` |

## Phase 5 automation (OMAR-PC Windows)

| Command | Purpose |
|---------|---------|
| `agent:phase5-auto` | One-window entry (pull → keep-awake → scheduler) |
| `agent:phase5-scheduler` | Day-live + overnight omni-train scheduler (Node) |
| `agent:phase5-night-now` | Run night train now |
| `agent:phase5-mark-night-done` | Skip tonight's training |
| `agent:phase5-reset-night` | Reset night state |
| `agent:phase5-preflight` | Pre-sleep checks |
| `agent:phase5-night-verify` / `agent:phase5-live-verify` | Post-train / live verify |
| `agent:phase5-sleep` / `agent:phase5-wake-resume` | Sleep / wake one-liners |
| `agent:phase5-live-now` / `agent:phase5-stable` | Skip-night live / stable mode |
| `agent:phase5-sanitize-remote` | Purge remote reload/stop commands |
| `agent:phase5-install-task` | Windows scheduled-task installer |
| `agent:dl-nightly` | DL nightly training |

## Training / learning

| Command | Purpose |
|---------|---------|
| `agent:learn` | Live learning cycles |
| `agent:turbo-learn` | Fast learn on mock feed |
| `agent:power-learn` | 20-cycle intensive training |
| `agent:deep-learn` | Deep live learning cycles |
| `agent:mega-train` | Batch train on klines |
| `agent:ultra-learn` | 30 cycles + 5000-bar full pipeline |
| `agent:omni-train` / `:quick` / `:night` | Omni/hyper training pipeline |
| `agent:curriculum` | Curriculum runner |
| `agent:teach-more` / `agent:teach-intensive` | Targeted teaching |
| `agent:auto-pipeline` | learn → deep → mega → ultra → export → verify |
| `agent:overnight-learn` | Phase-2 hybrid overnight (Windows) |
| `agent:path-resume` | Live + 5 learn cycles |

## Models / weights

| Command | Purpose |
|---------|---------|
| `agent:export-models` | Export model bundle |
| `agent:restore-weights` | Restore strategy weights |
| `agent:restore-ml-models` | Restore ML/MLP weights (dead-weight recovery) |

## Experiments / research / reports

| Command | Purpose |
|---------|---------|
| `agent:experiments` / `:quick` | Internal threshold sweeps (replay) |
| `agent:research-import` | Import research JSON |
| `agent:import-hf-research` | Import HF research bundle |
| `agent:import-md-reports` / `agent:bundle-reports` | Markdown report import/bundle |
| `agent:patterns` | Arabic pattern journal |
| `agent:log-review` / `:apply` | Second-agent log reviewer |

## Bridge / telemetry / remote

| Command | Purpose |
|---------|---------|
| `agent:local-bridge` | HTTP bridge on :8790 |
| `agent:push-telemetry` / `:ps1` | Collect + git push telemetry |
| `agent:tunnel-bridge` | ngrok tunnel |
| `agent:remote-watcher` | Poll remote commands |
| `agent:guard` / `agent:live-stack` | Guard / bridge+watcher+guard stack |
| `agent:fix-git-push` | Git push troubleshooting |

## Removed in cleanup (use the canonical command instead)

| Removed | Use instead |
|---------|-------------|
| `agent:directional-live` | `agent:phase2-live` |
| `agent:overnight-hybrid` | `agent:overnight-learn` |
| `agent:phase5-auto:node` | `agent:phase5-scheduler` |
| `agent:start:pnpm` / `:status:pnpm` / `:stop:pnpm` / `:test-run:pnpm` | `agent:start` / `agent:status` / `agent:stop` / `agent:test-run` |
