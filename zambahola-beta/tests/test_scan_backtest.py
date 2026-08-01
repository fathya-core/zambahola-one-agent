"""Tests for the real-strategy walk-forward backtest."""

from __future__ import annotations

import numpy as np
import pandas as pd

from zambahola_beta.scan_backtest import backtest_scan


def _frame(values: np.ndarray) -> pd.DataFrame:
    t = pd.date_range("2023-01-01", periods=len(values), freq="D")
    return pd.DataFrame({"open_time": t, "close": values})


def test_backtest_runs_and_returns_metrics():
    rng = np.random.default_rng(1)
    n = 360

    def series(drift: float) -> np.ndarray:
        return 100 * np.cumprod(1 + rng.normal(drift, 0.02, n))

    frames = {
        "BTCUSDT": _frame(series(0.002)),
        "AUSDT": _frame(series(0.004)),
        "BUSDT": _frame(series(0.003)),
        "CUSDT": _frame(series(0.0035)),
    }
    res = backtest_scan(frames, top_n=2, warmup=210, min_bars=300)
    assert res["ok"] is True
    assert res["days"] > 0
    assert "total_return" in res and "max_drawdown" in res and "sharpe" in res
    assert res["btc_hodl_return"] is not None
    assert res["max_drawdown"] <= 0  # drawdown is non-positive


def test_backtest_needs_enough_coins():
    res = backtest_scan({"AUSDT": _frame(100 * np.ones(400))}, min_bars=300)
    assert res["ok"] is False


def test_backtest_leverage_simulation_metrics():
    """max_lev > 1: same walk-forward but with per-coin levered notionals; the run
    must report gross exposure/liquidation stats and gross must respect the cap."""
    rng = np.random.default_rng(2)
    n = 360

    def series(drift: float) -> np.ndarray:
        return 100 * np.cumprod(1 + rng.normal(drift, 0.02, n))

    frames = {
        "BTCUSDT": _frame(series(0.002)),
        "AUSDT": _frame(series(0.004)),
        "BUSDT": _frame(series(0.003)),
        "CUSDT": _frame(series(0.0035)),
    }
    base = backtest_scan(frames, top_n=2, warmup=210, min_bars=300, max_lev=0.0)
    lev = backtest_scan(frames, top_n=2, warmup=210, min_bars=300,
                        max_lev=10.0, lev_target_vol=0.9, lev_gross_cap=2.0)
    assert base["ok"] and lev["ok"]
    assert "liq_events" in lev and "avg_gross" in lev
    # leverage deploys MORE notional than the unlevered run, but never above the cap
    assert lev["avg_gross"] >= base["avg_gross"] - 1e-9
    assert lev["avg_gross"] <= 2.0 + 0.1
