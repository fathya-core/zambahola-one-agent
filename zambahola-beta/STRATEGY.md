# ZAMBAHOLA BETA — Strategy report & implementation plan

This is the honest end-to-end conclusion of the research, the validated strategy,
and a staged plan to deploy it to a real wallet.

## 1. What we tested (and what the evidence said)

Every claim below is from the package's own leakage-safe, cost-aware backtests.

| Hypothesis | Result | Verdict |
|-----------|--------|---------|
| Short-horizon direction from OHLCV (BTC, 1m–4h) | OOS AUC ~0.51 | No edge |
| Short-horizon direction (altcoins) | AUC ~0.51 | No edge |
| L2 order-flow microstructure @5s | AUC ~0.83 but sub-bp move | Real but untradeable |
| Order-flow @30–60s, taker | edge ~0.09 bps « 14 bps cost | Net-negative |
| Order-flow @30–60s, maker | spread ~0.0016 bps, fee » edge | Net-negative |
| Cross-asset lead-lag (BTC/ETH → alts) | AUC ~0.50–0.54 | Too small after costs |
| Higher-TF "edges" (1h/4h) | Sharpe ~0.1, AUC ~0.5 | Trend/beta illusion |
| **Long-term trend allocation (daily)** | **see below** | **Real, profitable** |

Lesson: liquid-crypto short-term prediction is efficient; the durable retail
edge is **low-frequency trend-following**, where costs are negligible and the
value is capturing bull markets while sidestepping -80% crashes.

## 2. The validated strategy (full daily history, 10 bps/switch)

| Asset | Strategy | Total return | CAGR | Sharpe | Max DD | Calmar |
|-------|----------|-------------:|-----:|-------:|-------:|-------:|
| BTC | **SMA100 trend** | +2249% | 46.8% | 1.11 | **-38%** | **1.22** |
| BTC | Ensemble+VolTgt | +1828% | 43.3% | **1.13** | -51% | 0.84 |
| BTC | HODL | +799% | 30.6% | 0.74 | -77% | 0.40 |
| ETH | SMA50 trend | +2010% | 44.9% | 0.95 | -55% | 0.82 |
| ETH | HODL | +333% | 19.5% | 0.64 | -90% | 0.22 |

We also built a "thinking" allocator (signal consensus + volatility targeting +
multi-asset rotation). Honest finding: **it did not beat the simple SMA100 trend
on a risk-adjusted basis** (its best Sharpe 1.13 edges SMA100's 1.11, but Calmar
is lower). Adding leverage raised raw CAGR to ~54% but blew drawdown past -80% —
that is more risk, not more skill. **Simple, robust trend wins.**

## 3. Pick your profile (honest trade-offs)

| Profile | Strategy | Why |
|---------|----------|-----|
| Conservative / best risk-adjusted | **SMA100 (BTC)** | Highest Calmar, -38% worst DD |
| Balanced / smoothest | **Ensemble+VolTgt (BTC+ETH)** | Best Sharpe/Sortino, multi-asset, auto de-risk |
| Aggressive (high risk) | Rotation + leverage | Highest raw CAGR, but -80%+ DD — only with strict risk limits |

## 4. Live advisor (the "thinking", not a blind bot)

```powershell
# today's target allocation with transparent reasoning (run daily/weekly)
.\.venv\Scripts\python.exe -m zambahola_beta.cli signal --assets BTCUSDT,ETHUSDT --mode ensemble
# full strategy comparison on fresh data
.\.venv\Scripts\python.exe -m zambahola_beta.cli portfolio --assets BTCUSDT,ETHUSDT
```

The advisor reports per-asset trend consensus, realized volatility, target
weight, and an action (INVEST / PARTIAL / CASH). It thinks in terms of regime
and risk, and abstains (cash) in downtrends instead of holding through crashes.

## 5. Staged plan to a real wallet (do NOT skip steps)

1. **Paper / alerts (2–4 weeks).** Run `signal` weekly; record what it would have
   done. Confirm it matches the backtest behavior and you're comfortable with the
   cash periods.
2. **Tiny real allocation.** Apply the chosen profile (start with SMA100 BTC) to
   a small amount on Binance **spot** (no leverage). Rebalance weekly: above
   SMA100 → invested, below → cash/stable.
3. **Risk rules (always).** No leverage to start; cap any single rebalance; keep a
   hard "max % of net worth" limit; never override the cash signal emotionally.
4. **Scale only if live matches backtest** over a full minor cycle (up + down).
5. **Review quarterly** with `portfolio` on fresh data; the edge is structural
   (drawdown control), not a promise of 47% CAGR forever.

## 5b. Executor (testnet-first, keys stay out of the repo)

A safe spot executor follows the trend signal. **Defaults: testnet + dry-run.**

Keys are NEVER stored in the project. Point an env var at your existing file
(outside the repo) or set env vars directly — keys are only loaded at runtime and
never logged (only masked):

```powershell
# option A: point at your existing keys file (kept on your Desktop, not in repo)
$env:ZAMBAHOLA_KEYS_FILE = "C:\Users\pc\OneDrive\Desktop\binance-API.txt"
# option B: env vars
$env:BINANCE_API_KEY = "..."; $env:BINANCE_API_SECRET = "..."

# 1) TESTNET dry-run (fake money, places nothing) — see the plan
.\.venv\Scripts\python.exe -m zambahola_beta.cli execute --assets BTCUSDT,ETHUSDT --interval 1d
# 2) TESTNET execute (fake money, real testnet orders)  — needs testnet keys
.\.venv\Scripts\python.exe -m zambahola_beta.cli execute --interval 1d --execute
# 3) LIVE (real money) — ONLY after testnet works; requires explicit confirm:
$env:ZAMBAHOLA_I_ACCEPT_REAL_TRADING = "RISK"
.\.venv\Scripts\python.exe -m zambahola_beta.cli execute --interval 1d --live --execute --max-order-usd 20 --max-total-usd 100
```

Guarantees built in: spot only (no leverage), symbol whitelist, per-order and
total USD caps, min-notional checks, live blocked unless explicitly confirmed.
There is **no "only enter when guaranteed"** — that does not exist; the executor
follows the validated trend signal (invest in uptrends, cash in downtrends).

> Testnet keys are separate from live keys — create them at
> testnet.binance.vision. Start there.

## 6. Honest caveats

- The backtest spans a bull-heavy era; **future CAGR will be lower**.
- The durable advantage is **risk-adjusted compounding** (avoiding -80% crashes),
  not a guaranteed return. Past performance ≠ future results.
- Spot long/cash only in the safe profiles; leverage multiplies losses.
- This is research tooling and not financial advice.

## 7. Why this is the right answer to "best & most return"

It is the only approach that (1) showed a real edge after costs in rigorous
out-of-sample tests, (2) beats buy-and-hold on both return **and** drawdown,
(3) is implementable on an ordinary spot wallet with no HFT infrastructure, and
(4) keeps you solvent through bear markets so your capital compounds across
cycles.
