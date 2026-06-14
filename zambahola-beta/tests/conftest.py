import numpy as np
import pandas as pd
import pytest

from zambahola_beta.data import synthetic_klines


@pytest.fixture
def klines():
    return synthetic_klines(n=3000, seed=11)


@pytest.fixture
def small_klines():
    return synthetic_klines(n=400, seed=3)


def make_trend_klines(n=1500, slope=0.0008, seed=1):
    """Klines with a clean alternating trend so labels are unambiguous."""
    rng = np.random.default_rng(seed)
    # alternating up/down regimes of 50 bars
    regime = np.where((np.arange(n) // 50) % 2 == 0, slope, -slope)
    log_ret = regime + rng.normal(0, slope * 0.1, n)
    close = 100.0 * np.exp(np.cumsum(log_ret))
    high = close * 1.0005
    low = close * 0.9995
    open_ = np.concatenate([[100.0], close[:-1]])
    # varying volume/trades (real series are never perfectly flat)
    vol = rng.lognormal(mean=4.0, sigma=0.4, size=n)
    trades = rng.integers(50, 300, n).astype(float)
    start = pd.Timestamp("2025-01-01", tz="UTC")
    return pd.DataFrame(
        {
            "open_time": start + pd.to_timedelta(np.arange(n), unit="m"),
            "open": open_,
            "high": np.maximum.reduce([high, open_, close]),
            "low": np.minimum.reduce([low, open_, close]),
            "close": close,
            "volume": vol,
            "quote_volume": vol * close,
            "trades": trades,
            "taker_buy_base": vol * np.clip(0.5 + np.sign(regime) * 0.2, 0.05, 0.95),
        }
    )
