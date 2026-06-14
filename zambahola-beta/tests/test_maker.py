import numpy as np
import pandas as pd

from zambahola_beta.config import Config
from zambahola_beta.maker_backtest import maker_eval


def _oos(p_up, ret, spread_bps):
    return pd.DataFrame(
        {
            "p_up": np.array(p_up, float),
            "ret": np.array(ret, float),
            "spread_bps": np.array(spread_bps, float),
        }
    )


def test_maker_optimistic_beats_taker():
    # tiny gross edge (1 bp), wide spread (3 bps) -> maker captures spread.
    n = 60
    p_up = [0.9 if i % 2 == 0 else 0.1 for i in range(n)]
    ret = [0.0001 if i % 2 == 0 else -0.0001 for i in range(n)]  # 1 bp, correct sign
    spread = [3.0] * n
    cfg = Config(overlapping=True, fee_bps=5, long_threshold=0.58, short_threshold=0.42)
    res = maker_eval(_oos(p_up, ret, spread), cfg, maker_fee_bps=0.0, taker_fee_bps=5.0)
    assert res["n_trades"] == n
    # taker pays 10bps round trip vs 1bp edge -> negative; maker captures spread -> better
    assert res["taker_net_return"] < 0
    assert res["maker_net_optimistic"] > res["taker_net_return"]
    assert res["gross_edge_bps"] > 0


def test_breakeven_equals_gross_edge():
    n = 50
    p_up = [0.9] * n
    ret = [0.0002] * n  # 2 bps, all correct (long)
    spread = [1.0] * n
    cfg = Config(overlapping=True, long_threshold=0.58, short_threshold=0.42)
    res = maker_eval(_oos(p_up, ret, spread), cfg)
    assert abs(res["breakeven_roundtrip_bps"] - 2.0) < 1e-6


def test_no_trades_when_unconfident():
    n = 30
    res = maker_eval(
        _oos([0.5] * n, [0.001] * n, [2.0] * n),
        Config(overlapping=True, long_threshold=0.58, short_threshold=0.42),
    )
    assert res["n_trades"] == 0
    assert res["verdict"]["maker_profitable_conservative"] is False
