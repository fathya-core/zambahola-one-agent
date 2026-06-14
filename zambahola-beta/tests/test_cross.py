import numpy as np
import pandas as pd

from zambahola_beta.config import Config
from zambahola_beta.cross import (
    align_target_leaders,
    assemble_cross_dataset,
    build_cross_features,
    run_cross_search,
)
from zambahola_beta.features import FEATURE_COLUMNS


def _klines_from_close(close, seed=0):
    n = len(close)
    rng = np.random.default_rng(seed)
    close = np.asarray(close, float)
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.0003, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.0003, n)))
    vol = rng.lognormal(3.0, 0.3, n)
    return pd.DataFrame(
        {
            "open_time": pd.date_range("2025-01-01", periods=n, freq="5min", tz="UTC"),
            "open": open_, "high": high, "low": low, "close": close,
            "volume": vol, "quote_volume": vol * close,
            "trades": rng.integers(50, 300, n).astype(float),
            "taker_buy_base": vol * rng.uniform(0.4, 0.6, n),
        }
    )


def _leader_and_follower(n=4000, seed=1):
    """Leader is a random walk; follower = leader's PAST move + noise (lead-lag)."""
    rng = np.random.default_rng(seed)
    lead_ret = rng.normal(0, 0.002, n)
    lead_close = 100 * np.exp(np.cumsum(lead_ret))
    # follower next return follows leader's previous return (causal lead-lag)
    foll_ret = np.concatenate([[0.0], lead_ret[:-1]]) * 0.8 + rng.normal(0, 0.001, n)
    foll_close = 50 * np.exp(np.cumsum(foll_ret))
    return _klines_from_close(foll_close, seed=2), _klines_from_close(lead_close, seed=3)


def test_align_inner_joins_on_time():
    foll, lead = _leader_and_follower(n=500)
    merged = align_target_leaders(foll, {"BTCUSDT": lead})
    assert "BTCUSDT_close" in merged.columns
    assert len(merged) == 500


def test_cross_features_include_leader_columns():
    foll, lead = _leader_and_follower(n=800)
    merged = align_target_leaders(foll, {"BTCUSDT": lead})
    feat = build_cross_features(merged, ["BTCUSDT"])
    for col in [*FEATURE_COLUMNS, "BTCUSDT_ret1", "BTCUSDT_mom", "rs_BTCUSDT"]:
        assert col in feat.columns


def test_cross_dataset_clean():
    foll, lead = _leader_and_follower(n=2000)
    data = assemble_cross_dataset(foll, {"BTCUSDT": lead}, Config())
    assert len(data) > 0
    assert not data.drop(columns=["label", "ret"]).isna().any().any()


def test_cross_search_learns_leadlag_signal():
    foll, lead = _leader_and_follower(n=4000)
    base = Config(n_splits=4, embargo=20)
    lb = run_cross_search(
        base,
        {"FOLLOW": foll},
        {"BTCUSDT": lead},
        horizons=[4],
        barrier_mults=[1.0],
        margins=[0.10],
    )
    assert not lb.empty
    # the injected lead-lag should push AUC above chance
    assert lb["auc"].max() > 0.55
