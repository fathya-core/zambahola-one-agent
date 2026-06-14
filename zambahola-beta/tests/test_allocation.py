import numpy as np
import pandas as pd

from zambahola_beta.allocation import (
    backtest_allocation,
    buy_hold,
    compare_strategies,
    sma_trend,
)


def _daily(close):
    close = np.asarray(close, float)
    n = len(close)
    return pd.DataFrame(
        {
            "open_time": pd.date_range("2020-01-01", periods=n, freq="D", tz="UTC"),
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
            "volume": np.full(n, 100.0),
            "quote_volume": np.full(n, 100.0) * close,
            "trades": np.full(n, 100.0),
            "taker_buy_base": np.full(n, 50.0),
        }
    )


def _bull_then_crash(up_days=400, crash_days=200):
    up = 100 * np.cumprod(1 + np.full(up_days, 0.005))
    crash = up[-1] * np.cumprod(1 + np.full(crash_days, -0.01))
    return np.concatenate([up, crash])


def test_hodl_equity_matches_compound_return():
    close = 100 * np.cumprod(1 + np.full(300, 0.003))
    kl = _daily(close)
    res = backtest_allocation(kl, buy_hold(kl["close"]), cost_bps=0.0)
    expected = float((1 + kl["close"].pct_change().fillna(0)).prod())
    assert abs(res["final_equity"] - round(expected, 4)) < 0.05
    assert res["time_in_market"] >= 0.99  # day 1 has no prior position


def test_trend_avoids_crash_better_than_hodl():
    kl = _daily(_bull_then_crash())
    trend = backtest_allocation(kl, sma_trend(kl["close"], 100), cost_bps=10.0)
    hodl = backtest_allocation(kl, buy_hold(kl["close"]), cost_bps=10.0)
    # trend steps aside in the crash -> shallower drawdown and higher final equity
    assert trend["max_drawdown"] > hodl["max_drawdown"]
    assert trend["final_equity"] > hodl["final_equity"]
    assert trend["time_in_market"] < 1.0


def test_costs_reduce_return():
    # whipsaw series forces frequent switches
    rng = np.random.default_rng(0)
    close = 100 * np.cumprod(1 + rng.normal(0, 0.03, 500))
    kl = _daily(close)
    pos = sma_trend(kl["close"], 5)
    free = backtest_allocation(kl, pos, cost_bps=0.0)["final_equity"]
    costly = backtest_allocation(kl, pos, cost_bps=50.0)["final_equity"]
    assert costly < free


def test_compare_strategies_includes_hodl_and_metrics():
    kl = _daily(_bull_then_crash())
    table = compare_strategies(kl, cost_bps=10.0)
    assert "HODL" in set(table["strategy"])
    for col in ("cagr", "sharpe", "max_drawdown", "calmar", "final_equity"):
        assert col in table.columns
