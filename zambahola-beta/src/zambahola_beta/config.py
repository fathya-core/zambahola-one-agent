"""Central configuration for ZAMBAHOLA BETA.

One dataclass holds every tunable so the whole pipeline is reproducible and the
design stays simple/clear. All knobs have research-informed defaults.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PKG_ROOT / "data"
REPORTS_DIR = PKG_ROOT / "reports"


@dataclass(frozen=True)
class Config:
    # --- market / data ---
    symbol: str = "BTCUSDT"
    interval: str = "1m"
    bars: int = 30_000  # how many klines to fetch for offline training

    # --- labeling (triple-barrier, volatility-scaled) ---
    horizon: int = 15  # bars to look ahead for the label/trade
    vol_window: int = 60  # rolling window for volatility estimate
    barrier_mult: float = 1.0  # barrier = barrier_mult * vol * price

    # --- model / validation ---
    n_splits: int = 5  # purged walk-forward folds
    embargo: int = 30  # bars purged between train and test (>= horizon)
    max_iter: int = 400  # HistGradientBoosting boosting iterations
    learning_rate: float = 0.05
    max_depth: int | None = 4
    min_samples_leaf: int = 200
    l2_regularization: float = 1.0
    val_fraction: float = 0.2  # tail of each train fold used for calibration
    random_state: int = 42

    # --- backtest (cost-aware) ---
    fee_bps: float = 5.0  # taker fee per side, basis points (0.05%)
    slippage_bps: float = 2.0  # assumed slippage per side, basis points
    long_threshold: float = 0.58  # P(up) above -> long
    short_threshold: float = 0.42  # P(up) below -> short
    overlapping: bool = False  # False = step by horizon (non-overlapping bets)
    periods_per_year: int = field(default=0)  # 0 = auto from interval

    # --- paths ---
    data_dir: Path = DATA_DIR
    reports_dir: Path = REPORTS_DIR

    def klines_path(self) -> Path:
        return self.data_dir / f"klines_{self.symbol}_{self.interval}.parquet"

    def bars_per_year(self) -> float:
        if self.periods_per_year:
            return float(self.periods_per_year)
        minutes = _interval_minutes(self.interval)
        # one bet every `horizon` bars (non-overlapping) for annualization
        step = self.horizon if not self.overlapping else 1
        return (365 * 24 * 60) / (minutes * step)


def _interval_minutes(interval: str) -> float:
    units = {"m": 1, "h": 60, "d": 60 * 24}
    unit = interval[-1]
    if unit not in units:
        raise ValueError(f"unsupported interval: {interval}")
    return float(interval[:-1]) * units[unit]
