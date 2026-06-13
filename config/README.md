# config/ profiles registry

Each `.env` here is a runtime/training profile loaded by
`scripts/core/run-env.mjs --file config/<name>.env`. Phases are **not** a linear
deprecation — several remain runnable for different goals. Current
recommended profiles are marked below.

## Live / runtime profiles

| Profile | npm command | When to use | Status |
|---------|-------------|-------------|--------|
| `max-accuracy.env` | `agent:start` | Default full-power local profile (micro gates + meta) | current |
| `phase5-ready.env` | `agent:phase5-ready` | OMAR-PC day-live used by the phase5 scheduler | current |
| `phase4-hit-recover.env` | `agent:phase4-hit-recover` | Strict directional recovery (no live ML pollution) | active |
| `phase3-intensive.env` | `agent:phase3-intensive` | Hybrid + intensive learn, relaxed guard | active |
| `phase2-live.env` | `agent:phase2-live` | Phase-2 micro gates + meta-PnL + Arabic analyst | active |
| `phase2-signals.env` | `agent:phase2-signals` | More up/down signals, looser gates | active |
| `phase2-learn-trade.env` | `agent:phase2-learn-trade` | Fast paper trades for learning | active |
| `phase2-hybrid.env` | `agent:phase2-hybrid` | Auto-switch learn-trade ↔ signals | active |
| `directional-live.env` | — | Orphan; superseded by `phase2-live.env` | legacy |

## Training / offline profiles

| Profile | npm command | When to use |
|---------|-------------|-------------|
| `omni-train.env` | `agent:omni-train` | Full omni/hyper learn (mock feed) |
| `phase5-night-train.env` | `agent:omni-train:night` | Strong overnight omni-train (Windows) |

## Bridge / secrets (gitignored)

| File | Purpose |
|------|---------|
| `bridge.env` / `bridge.env.example` | Local bridge token/port |
| `exchange-demo.env.example` | Exchange demo keys template (copy to `exchange.env`) |

## Notes

- `phase5-ready.env` extends `phase4-hit-recover.env` with Phase-5 flags
  (scheduler timing, DL-live-auto, guard restart hints).
- Never commit real exchange keys. `exchange.env` and `bridge.env` are
  gitignored.
