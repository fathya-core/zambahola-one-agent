import numpy as np

from zambahola_beta.config import Config
from zambahola_beta.micro_features import MICRO_FEATURE_COLUMNS, build_micro_features
from zambahola_beta.pipeline import assemble_micro_dataset, run_micro_pipeline
from zambahola_beta.recorder import synthetic_micro


def test_micro_features_columns_and_finite():
    micro = synthetic_micro(n=2000, seed=2)
    feat = build_micro_features(micro)
    assert list(feat.columns) == MICRO_FEATURE_COLUMNS
    valid = feat.dropna()
    assert len(valid) > 0
    assert np.isfinite(valid.to_numpy()).all()


def test_assemble_micro_dataset_clean():
    micro = synthetic_micro(n=3000, seed=3)
    data = assemble_micro_dataset(micro, Config())
    assert len(data) > 0
    for col in [*MICRO_FEATURE_COLUMNS, "label", "ret"]:
        assert col in data.columns
    assert not data[MICRO_FEATURE_COLUMNS].isna().any().any()


def test_micro_pipeline_learns_injected_orderflow_signal():
    # synthetic_micro injects an OFI/imbalance -> next-return relationship,
    # so the model must beat chance on out-of-sample micro data.
    micro = synthetic_micro(n=8000, seed=5)
    cfg = Config(horizon=5, vol_window=60, barrier_mult=1.0, n_splits=4, embargo=20)
    report = run_micro_pipeline(cfg, micro=micro, write_report=False)
    assert report["source"]["kind"] == "micro"
    assert report["validation"]["folds"] >= 1
    assert report["validation"]["mean_auc"] > 0.5
