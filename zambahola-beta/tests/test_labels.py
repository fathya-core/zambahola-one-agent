import numpy as np
import pandas as pd

from zambahola_beta.labels import directional_dataset, triple_barrier


def _flat_then_move(direction: str, n=300, move=0.05):
    """Flat warmup so vol>0, then a strong sustained move in `direction`."""
    base = np.full(n, 100.0)
    rng = np.random.default_rng(0)
    base = base + rng.normal(0, 0.02, n)  # tiny noise -> positive vol
    if direction == "up":
        base[150:] = base[150:] + np.linspace(0, move * 100, n - 150)
    else:
        base[150:] = base[150:] - np.linspace(0, move * 100, n - 150)
    close = pd.Series(base)
    return pd.DataFrame(
        {
            "open_time": pd.date_range("2025-01-01", periods=n, freq="min", tz="UTC"),
            "open": close.shift(1).fillna(close.iloc[0]),
            "high": close * 1.0,
            "low": close * 1.0,
            "close": close,
            "volume": np.full(n, 10.0),
            "quote_volume": np.full(n, 1000.0),
            "trades": np.full(n, 10.0),
            "taker_buy_base": np.full(n, 5.0),
        }
    )


def test_up_move_labels_up():
    df = _flat_then_move("up")
    res = triple_barrier(df, horizon=20, vol_window=60, barrier_mult=1.0)
    # at the start of the move, the next bars rise -> label up
    assert res.label.iloc[160] == 1.0
    assert res.touch.iloc[160] in ("up", "timeout")


def test_down_move_labels_down():
    df = _flat_then_move("down")
    res = triple_barrier(df, horizon=20, vol_window=60, barrier_mult=1.0)
    assert res.label.iloc[160] == -1.0


def test_tail_is_unlabeled():
    df = _flat_then_move("up", n=200)
    res = triple_barrier(df, horizon=20, vol_window=60, barrier_mult=1.0)
    # last `horizon` bars cannot be labeled (no future) -> NaN
    assert res.label.iloc[-1] != res.label.iloc[-1]  # NaN check


def test_directional_dataset_is_binary():
    df = _flat_then_move("up")
    res = triple_barrier(df, horizon=20, vol_window=60, barrier_mult=1.0)
    idx, y = directional_dataset(res)
    assert set(np.unique(y.to_numpy())).issubset({0, 1})
    assert len(idx) == len(y)
