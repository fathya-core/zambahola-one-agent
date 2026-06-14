# ZAMBAHOLA BETA

A radical rebuild of the prediction brain — **simpler, clearer, and honest**.

The original TS agent is a great *operational* shell but its models are toys, its
"LOB" is a coarse REST snapshot, and it has **no out-of-sample validation** — so
it can't tell whether it actually has an edge. ZAMBAHOLA BETA is the missing
**scientific core**: an offline, leakage-safe ML pipeline whose job is to answer
one question truthfully —

> Is there a directional edge in BTC **after trading costs**, proven on
> out-of-sample data? If not, it says so and refuses to greenlight real money.

## Philosophy

- **Edge after costs, not raw accuracy.** Short-horizon crypto direction is hard;
  realistic edges are tiny (53–57%). The deliverable is positive risk-adjusted
  expectancy *after fees + slippage*, validated out-of-sample.
- **No leakage, ever.** Causal features + purged walk-forward CV with an embargo.
- **Honest verdict.** Every run ends with `has_edge_after_costs: true/false`.

## Pipeline

```
data (Binance klines)            data.py
  -> features (price + order-flow)  features.py
  -> labels (vol-scaled triple-barrier)  labels.py
  -> model (HistGradientBoosting + isotonic, purged walk-forward)  model.py
  -> cost-aware backtest (fees + slippage, Sharpe/DD/expectancy)  backtest.py
  -> verdict + JSON report          pipeline.py
```

Each stage is one small module with a single responsibility.

## Setup

```powershell
cd zambahola-beta
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
```

## Usage

```powershell
# Offline smoke run (no network, synthetic data)
.\.venv\Scripts\python.exe -m zambahola_beta.cli run --synthetic

# Real run: download klines + validate + backtest
.\.venv\Scripts\python.exe -m zambahola_beta.cli run --bars 30000 --horizon 15

# Just fetch data to parquet
.\.venv\Scripts\python.exe -m zambahola_beta.cli fetch --bars 30000

# Phase 2: grid-search for an edge across interval x horizon x barrier x threshold
.\.venv\Scripts\python.exe -m zambahola_beta.cli search --bars 20000 \
  --intervals 5m,15m,1h --horizons 4,8,16 --mults 1.0,2.0 --margins 0.06,0.10

# Phase 3: record real L2 microstructure (run for hours/days to build a dataset)
.\.venv\Scripts\python.exe -m zambahola_beta.cli record --seconds 3600
# then validate the order-flow edge on the recorded data
.\.venv\Scripts\python.exe -m zambahola_beta.cli micro-run --horizon 5
```

Reports are written to `reports/report_<symbol>_<interval>.json`; the search
leaderboard to `reports/search_leaderboard.csv`.

## Tests / quality

```powershell
.\.venv\Scripts\python.exe -m pytest        # 20 tests
.\.venv\Scripts\python.exe -m ruff check src tests
```

## Modules

| Module | Responsibility |
|--------|----------------|
| `config.py` | One frozen dataclass with every tunable (symbol, horizon, costs, CV) |
| `data.py` | Binance public klines -> parquet; deterministic synthetic generator |
| `features.py` | Causal price + microstructure features (taker-buy order-flow proxies) |
| `labels.py` | Volatility-scaled triple-barrier labels + realized returns |
| `model.py` | HistGradientBoosting + isotonic calibration; purged walk-forward CV |
| `backtest.py` | Cost-aware long/short/flat backtest + Sharpe/Sortino/DD/expectancy |
| `search.py` | Phase-2 grid search (interval x horizon x barrier x threshold) -> leaderboard |
| `recorder.py` | Phase-3 live L2 recorder (Binance depth20 + aggTrade) -> Cont OFI + book/trade flow bars |
| `micro_features.py` | Order-flow / microstructure features from recorded bars |
| `pipeline.py` | Orchestrates klines or micro stages; emits the verdict + JSON report |
| `cli.py` | `fetch` / `run` / `search` / `record` / `micro-run` |

## Current honest result (Phase 2 search)

A grid search of **36 configs** across intervals (5m/15m/1h), horizons
(4/8/16), barrier multipliers and confidence thresholds found **zero** with a
positive edge after costs. Best out-of-sample **AUC ≈ 0.52**; all net-negative.

Conclusion: **OHLCV-only features carry no exploitable directional edge after
costs** on BTC — the efficient-market reality. Tuning won't fix this; a
different *signal source* is required.

## Phase 3 finding (real, but maker-only)

On ~4.6h of recorded BTC L2 data:
- Order-flow features predict the **immediate next-tick** move strongly
  (AUC ~0.83 at 5s) but that decays to AUC ~0.5-0.58 by 30-300s.
- A `micro-search` across horizons shows a **real, positive GROSS edge** at
  30-60s (AUC ~0.65, positive expectancy) — but only ~0.3-0.5 bps/trade.
- Taker round-trip cost (~14 bps) is ~40x the edge, so **taker execution is
  net-negative**. Under zero/maker costs, 11/12 configs are profitable.

Conclusion: the signal is genuine and monetizable **only with maker (limit-order)
execution** — capturing order-flow alpha is a market-making game, not a taker
game. Sample is also still tiny (needs days, not hours, for significance).

```powershell
# search the micro edge across horizons/barriers/thresholds (taker costs)
.\.venv\Scripts\python.exe -m zambahola_beta.cli micro-search
# test the signal under maker (zero-cost) execution
.\.venv\Scripts\python.exe -m zambahola_beta.cli micro-search --fee-bps 0 --slippage-bps 0
```

## Phase 3 (built): real microstructure data path

The L2 recorder + order-flow feature path now exists and is verified on live
Binance data (`recorder.py`, `micro_features.py`, `micro-run`). It records Cont
order-flow imbalance, multi-level book imbalance, microprice and signed trade
flow into mid-price OHLC bars, then runs the same leakage-safe, cost-aware
validation. A model test confirms it learns an injected order-flow signal.

**What remains to find a real edge:** runtime. Microstructure data must be
*accumulated* by leaving `record` running for hours/days (ideally a rolling
collector), then `micro-run` (or a micro grid search) checks for a validated
edge after costs. Only then: Binance testnet -> tiny real size, with strict risk
limits (position sizing, stop-loss, daily loss cap).

Other levers if order-flow alone is insufficient: cross-asset lead-lag,
funding/OI regimes, sentiment. The verdict stays honest throughout.
