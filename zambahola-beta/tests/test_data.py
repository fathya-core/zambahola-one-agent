import numpy as np

from zambahola_beta.data import COLUMNS, synthetic_klines


def test_synthetic_shape_and_columns():
    df = synthetic_klines(n=500, seed=1)
    assert len(df) == 500
    for col in COLUMNS:
        assert col in df.columns


def test_synthetic_is_deterministic():
    a = synthetic_klines(n=300, seed=42)
    b = synthetic_klines(n=300, seed=42)
    assert np.allclose(a["close"].to_numpy(), b["close"].to_numpy())


def test_ohlc_invariants():
    df = synthetic_klines(n=1000, seed=5)
    assert (df["high"] >= df["low"]).all()
    assert (df["high"] >= df["close"]).all()
    assert (df["high"] >= df["open"]).all()
    assert (df["low"] <= df["close"]).all()
    assert (df["low"] <= df["open"]).all()
    assert (df["volume"] > 0).all()
    assert (df["taker_buy_base"] <= df["volume"]).all()
