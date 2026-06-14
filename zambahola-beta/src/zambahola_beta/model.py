"""Model + leakage-safe validation.

- CalibratedModel: HistGradientBoosting (histogram gradient-boosted trees, the
  practical SOTA for tabular market features) + isotonic probability calibration.
- purged_walkforward_splits: expanding-window walk-forward with an embargo gap so
  overlapping labels never leak future info into training.
- walk_forward_eval: trains per fold on directional bars, scores every test bar,
  returns out-of-sample P(up) for the backtest plus per-fold metrics.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)

from .config import Config
from .features import FEATURE_COLUMNS


class CalibratedModel:
    """Gradient-boosted trees with isotonic-calibrated probabilities."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.clf: HistGradientBoostingClassifier | None = None
        self.iso: IsotonicRegression | None = None

    def fit(self, X: pd.DataFrame, y: pd.Series) -> "CalibratedModel":
        cfg = self.cfg
        n = len(X)
        n_val = int(n * cfg.val_fraction)
        if n_val >= 20 and (n - n_val) >= 50:
            X_tr, y_tr = X.iloc[:-n_val], y.iloc[:-n_val]
            X_val, y_val = X.iloc[-n_val:], y.iloc[-n_val:]
        else:
            X_tr, y_tr, X_val, y_val = X, y, X, y

        self.clf = HistGradientBoostingClassifier(
            max_iter=cfg.max_iter,
            learning_rate=cfg.learning_rate,
            max_depth=cfg.max_depth,
            min_samples_leaf=cfg.min_samples_leaf,
            l2_regularization=cfg.l2_regularization,
            early_stopping=False,
            random_state=cfg.random_state,
        )
        self.clf.fit(X_tr, y_tr)

        # Isotonic calibration needs both classes present in the validation tail.
        raw_val = self.clf.predict_proba(X_val)[:, 1]
        if len(np.unique(y_val)) == 2:
            self.iso = IsotonicRegression(out_of_bounds="clip").fit(raw_val, y_val.to_numpy())
        else:
            self.iso = None
        return self

    def predict_proba_up(self, X: pd.DataFrame) -> np.ndarray:
        if self.clf is None:
            raise RuntimeError("model not fitted")
        raw = self.clf.predict_proba(X)[:, 1]
        if self.iso is not None:
            return np.clip(self.iso.predict(raw), 0.0, 1.0)
        return raw


def purged_walkforward_splits(
    n: int, n_splits: int, embargo: int
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Expanding-window folds with an embargo purge between train and test."""
    if n_splits < 1 or n < (n_splits + 1) * 2:
        return []
    fold = n // (n_splits + 1)
    splits: list[tuple[np.ndarray, np.ndarray]] = []
    for k in range(1, n_splits + 1):
        test_start = k * fold
        test_end = (k + 1) * fold if k < n_splits else n
        train_end = max(0, test_start - embargo)
        train_idx = np.arange(0, train_end)
        test_idx = np.arange(test_start, test_end)
        if len(train_idx) >= 50 and len(test_idx) >= 10:
            splits.append((train_idx, test_idx))
    return splits


@dataclass
class WalkForwardOutput:
    oos: pd.DataFrame  # columns: p_up, label, ret  (out-of-sample, temporal order)
    fold_metrics: list[dict]

    def mean_metric(self, key: str) -> float:
        vals = [m[key] for m in self.fold_metrics if m.get(key) is not None]
        return float(np.mean(vals)) if vals else float("nan")


def _fold_metrics(y_true: np.ndarray, p_up: np.ndarray) -> dict:
    out: dict = {"n": int(len(y_true))}
    if len(np.unique(y_true)) < 2:
        out.update(accuracy=None, auc=None, logloss=None, brier=None)
        return out
    pred = (p_up >= 0.5).astype(int)
    p_clip = np.clip(p_up, 1e-6, 1 - 1e-6)
    out["accuracy"] = float(accuracy_score(y_true, pred))
    out["auc"] = float(roc_auc_score(y_true, p_up))
    out["logloss"] = float(log_loss(y_true, p_clip, labels=[0, 1]))
    out["brier"] = float(brier_score_loss(y_true, p_up))
    return out


def walk_forward_eval(data: pd.DataFrame, cfg: Config) -> WalkForwardOutput:
    """Run purged walk-forward; return OOS predictions + per-fold metrics.

    `data` must be temporally ordered with FEATURE_COLUMNS plus 'label' and 'ret'.
    """
    data = data.reset_index(drop=True)
    splits = purged_walkforward_splits(len(data), cfg.n_splits, cfg.embargo)
    if not splits:
        raise ValueError("not enough rows for the requested walk-forward splits")

    oos_frames: list[pd.DataFrame] = []
    fold_metrics: list[dict] = []

    for train_idx, test_idx in splits:
        train = data.iloc[train_idx]
        dir_train = train[train["label"] != 0.0]
        if dir_train["label"].nunique() < 2 or len(dir_train) < 60:
            continue
        X_tr = dir_train[FEATURE_COLUMNS]
        y_tr = (dir_train["label"] == 1.0).astype(int)

        model = CalibratedModel(cfg).fit(X_tr, y_tr)

        test = data.iloc[test_idx]
        p_up = model.predict_proba_up(test[FEATURE_COLUMNS])
        frame = pd.DataFrame(
            {"p_up": p_up, "label": test["label"].to_numpy(), "ret": test["ret"].to_numpy()},
            index=test.index,
        )
        oos_frames.append(frame)

        dir_test = test[test["label"] != 0.0]
        if len(dir_test):
            y_te = (dir_test["label"] == 1.0).astype(int).to_numpy()
            p_te = frame.loc[dir_test.index, "p_up"].to_numpy()
            fold_metrics.append(_fold_metrics(y_te, p_te))

    if not oos_frames:
        raise ValueError("no usable folds (insufficient directional samples)")

    oos = pd.concat(oos_frames).sort_index()
    return WalkForwardOutput(oos=oos, fold_metrics=fold_metrics)
