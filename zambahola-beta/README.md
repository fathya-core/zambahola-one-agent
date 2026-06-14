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
| `pipeline.py` | Orchestrates the stages and emits the verdict + JSON report |
| `cli.py` | `fetch` / `run` commands |

## Current honest result (Phase 2 search)

A grid search of **36 configs** across intervals (5m/15m/1h), horizons
(4/8/16), barrier multipliers and confidence thresholds found **zero** with a
positive edge after costs. Best out-of-sample **AUC ≈ 0.52**; all net-negative.

Conclusion: **OHLCV-only features carry no exploitable directional edge after
costs** on BTC — the efficient-market reality. Tuning won't fix this; a
different *signal source* is required.

## Where the edge will come from (next: Phase 3)

1. **True microstructure data** (highest potential): record the Binance L2
   order-book diff stream + trade prints over time to build a dataset, then
   engineer real order-flow imbalance features. Research attributes ~80% of
   short-horizon predictability to these.
2. **Cross-asset / alternative data**: lead-lag from correlated assets, funding/OI
   regimes, sentiment.
3. **Only after a validated edge**: promote to Binance testnet -> tiny real size,
   with strict risk limits (position sizing, stop-loss, daily loss cap).

The search engine makes this systematic — add a signal source, re-run `search`,
and the verdict stays honest.
