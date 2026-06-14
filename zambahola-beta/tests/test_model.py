import numpy as np
import pandas as pd

from zambahola_beta.config import Config
from zambahola_beta.features import FEATURE_COLUMNS
from zambahola_beta.model import (
    CalibratedModel,
    purged_walkforward_splits,
    walk_forward_eval,
)


def test_purged_splits_no_overlap_and_embargo():
    splits = purged_walkforward_splits(n=1200, n_splits=5, embargo=30)
    assert len(splits) >= 1
    for train_idx, test_idx in splits:
        assert len(np.intersect1d(train_idx, test_idx)) == 0
        # embargo gap respected: last train index < first test index - embargo + 1
        assert train_idx.max() <= test_idx.min() - 30
        # train strictly precedes test (walk-forward)
        assert train_idx.max() < test_idx.min()


def test_calibrated_model_learns_signal():
    # y depends strongly on the first feature -> model must beat chance.
    rng = np.random.default_rng(0)
    n = 2000
    signal = rng.normal(size=n)
    y = (signal + rng.normal(scale=0.5, size=n) > 0).astype(int)
    X = pd.DataFrame({c: rng.normal(size=n) for c in FEATURE_COLUMNS})
    X[FEATURE_COLUMNS[0]] = signal
    model = CalibratedModel(Config()).fit(X.iloc[:1500], pd.Series(y[:1500]))
    p = model.predict_proba_up(X.iloc[1500:])
    assert ((p >= 0) & (p <= 1)).all()
    acc = ((p >= 0.5).astype(int) == y[1500:]).mean()
    assert acc > 0.7


def _learnable_dataset(n=4000, seed=0):
    rng = np.random.default_rng(seed)
    signal = rng.normal(size=n)
    data = pd.DataFrame({c: rng.normal(size=n) for c in FEATURE_COLUMNS})
    data[FEATURE_COLUMNS[0]] = signal
    up = (signal + rng.normal(scale=0.6, size=n) > 0)
    data["label"] = np.where(up, 1.0, -1.0)
    data["ret"] = np.where(up, 0.01, -0.01)
    return data


def test_walk_forward_eval_beats_chance_on_learnable_data():
    cfg = Config(n_splits=4, embargo=30)
    out = walk_forward_eval(_learnable_dataset(), cfg)
    assert len(out.oos) > 0
    assert out.mean_metric("auc") > 0.6
    assert set(out.oos.columns) == {"p_up", "label", "ret"}
    # OOS predictions are probabilities
    assert out.oos["p_up"].between(0, 1).all()
