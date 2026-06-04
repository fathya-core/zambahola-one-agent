# Local max accuracy (home PC)

## One command train

```bash
npm run setup
npm run agent:max-accuracy
```

## Live trading (paper) after train

```bash
npm run agent:max-accuracy:start
```

Dashboard: http://127.0.0.1:8787 — engine `hybrid_v7_max` when `ZAMBAHOLA_ACCURACY_MODE=max`.

## Config

See `config/max-accuracy.env`. Key vars:

- `ZAMBAHOLA_ACCURACY_MODE=max` — strict consensus filter
- `ZAMBAHOLA_FAST=1` — Binance aggTrade ~350ms ticks
- `ZAMBAHOLA_ULTRA_KLINES=10000` — deep history train

## Hit rate vs volume

Max mode **abstains** on weak signals (`direction=range`). Measured hit rate on directional calls typically improves; total directional count drops.
