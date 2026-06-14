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
```

Reports are written to `reports/report_<symbol>_<interval>.json`.

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

## Current honest result

On BTCUSDT 1m, horizon 15, with klines-only features, out-of-sample
**AUC ≈ 0.51** and the cost-aware backtest is **negative** → no edge yet. This is
the expected, truthful baseline. It also proves the validation + cost gate work.

## Where the edge will come from (next)

1. **Better data**: true L2 order-book event stream (depth diffs), not snapshots.
2. **Horizon search**: longer horizons (5–60 min) are more predictable than 1m.
3. **Richer features**: multi-timeframe, cross-asset, funding/OI regimes.
4. **Only then**: promote to Binance testnet -> tiny real size, with risk limits.

The pipeline is built to search these systematically — change `Config` and re-run;
the verdict stays honest.
