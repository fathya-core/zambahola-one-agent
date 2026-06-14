import numpy as np

from zambahola_beta.features import (
    FEATURE_COLUMNS,
    build_features,
    build_features_aligned,
)


def test_feature_columns_present(klines):
    feat = build_features(klines)
    assert list(feat.columns) == FEATURE_COLUMNS


def test_aligned_features_have_no_nans(klines):
    feat, idx = build_features_aligned(klines)
    assert len(feat) > 0
    assert not feat.isna().any().any()
    assert np.isfinite(feat.to_numpy()).all()


def test_no_lookahead_features_are_causal(klines):
    """Truncating future bars must not change a feature computed at bar t."""
    feat_full = build_features(klines)
    cutoff = 1500
    feat_trunc = build_features(klines.iloc[: cutoff + 1])
    row_full = feat_full.iloc[cutoff]
    row_trunc = feat_trunc.iloc[cutoff]
    # equal where both defined (NaNs only differ in warmup, not at cutoff)
    a = row_full.to_numpy(dtype=float)
    b = row_trunc.to_numpy(dtype=float)
    mask = np.isfinite(a) & np.isfinite(b)
    assert mask.any()
    assert np.allclose(a[mask], b[mask], rtol=1e-9, atol=1e-12)


def test_taker_buy_ratio_sign(klines):
    feat = build_features(klines)
    # values are centered at 0 (ratio - 0.5), within [-0.5, 0.5]
    s = feat["taker_buy_ratio"].dropna()
    assert (s >= -0.5 - 1e-9).all() and (s <= 0.5 + 1e-9).all()
