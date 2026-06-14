import numpy as np
import pandas as pd

from zambahola_beta.backtest import run_backtest
from zambahola_beta.config import Config


def _oos(p_up, ret):
    return pd.DataFrame({"p_up": np.array(p_up, float), "ret": np.array(ret, float)})


def test_perfect_predictions_with_wide_targets_are_profitable():
    # Targets (1%) comfortably exceed round-trip cost (~0.14%).
    n = 60
    p_up = [0.9 if i % 2 == 0 else 0.1 for i in range(n)]
    ret = [0.01 if i % 2 == 0 else -0.01 for i in range(n)]
    cfg = Config(overlapping=True, fee_bps=5, slippage_bps=2)
    res = run_backtest(_oos(p_up, ret), cfg)
    assert res["n_trades"] == n
    assert res["net_return"] > 0
    assert res["directional_accuracy"] == 1.0
    assert res["expectancy"] > 0


def test_costs_make_tiny_edges_unprofitable():
    # Correct direction but move (0.05%) below round-trip cost (0.14%).
    n = 50
    p_up = [0.9] * n
    ret = [0.0005] * n
    cfg = Config(overlapping=True, fee_bps=5, slippage_bps=2)
    res = run_backtest(_oos(p_up, ret), cfg)
    assert res["directional_accuracy"] == 1.0  # direction right
    assert res["net_return"] < 0  # but costs win


def test_flat_when_not_confident_means_no_trades():
    n = 40
    p_up = [0.5] * n
    ret = [0.01 if i % 2 == 0 else -0.01 for i in range(n)]
    cfg = Config(overlapping=True, long_threshold=0.58, short_threshold=0.42)
    res = run_backtest(_oos(p_up, ret), cfg)
    assert res["n_trades"] == 0
    assert res["net_return"] == 0.0


def test_gross_exceeds_net_due_to_costs():
    rng = np.random.default_rng(0)
    n = 200
    p_up = rng.uniform(0, 1, n)
    ret = rng.normal(0, 0.01, n)
    cfg = Config(overlapping=True)
    res = run_backtest(_oos(p_up, ret), cfg)
    assert res["gross_return"] >= res["net_return"] - 1e-12
