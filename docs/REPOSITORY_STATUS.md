# Repository status — verified in cloud

**Branch:** `cursor/dev-env-setup-744b`  
**PR:** https://github.com/fathya-core/zambahola-one-agent/pull/1  
**Last verification (cloud VM):** 2026-06-04 — `npm run verify` → 9/9 checks OK; `ultra-learn` 1-cycle smoke OK; CoinGecko feed start OK

## Implemented (confirmed in repo)

| Item | Status |
|------|--------|
| 17 strategies | ✓ |
| hybrid_v7 engine | ✓ |
| 5-layer AI (ensemble, ML, MLP, GBM, LOB-CNN) | ✓ |
| Universal + CoinGecko + mock feeds | ✓ |
| learn 25 / deep 25 / ultra 30 cycles (config) | ✓ |
| mega-train 3000 / ultra 5000 klines | ✓ |
| ultra-learn pipeline | ✓ |
| Paper only, no API keys | ✓ |

## Exchange APIs (cloud VM note)

Binance/Bybit may return **geo-block** on some hosts. Fallbacks:

1. Bybit klines (if allowed)
2. **CoinGecko** live price (`ZAMBAHOLA_FEED=coingecko`) — verified BTC ~$63k
3. Synthetic klines for offline train/backtest

On a home network without geo-block, `universal` uses Binance live.

## Verification command (run in CI)

```bash
npm run verify
```

Output: `docs/VERIFICATION_REPORT.json`
