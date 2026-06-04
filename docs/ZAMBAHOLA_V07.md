# ZAMBAHOLA v0.7

## Engine `hybrid_v7`

Same 17-strategy + ML stack as v0.6; operational upgrades:

| Feature | Env / module |
|---------|----------------|
| 10k kline cache | `ZAMBAHOLA_ULTRA_KLINES=10000`, `fetchKlines10k` |
| Bybit-primary feed | `ZAMBAHOLA_BYBIT_PRIMARY=1` or `ZAMBAHOLA_AUTO_BYBIT=1` |
| Deeper LOB history | `ZAMBAHOLA_LOB_DEPTH=128` (default) |
| Model bundle export | `npm run agent:export-models` → `data/learning/export/hybrid_v7-bundle.json` |
| Autonomous pipeline | `npm run agent:auto-pipeline` |

## Autonomous mode

Runs learn → deep → mega → ultra → export → verify without interaction.

```bash
ZAMBAHOLA_LEARN_CYCLES=15 ZAMBAHOLA_ULTRA_CYCLES=6 npm run agent:auto-pipeline
```
