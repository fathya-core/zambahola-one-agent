import numpy as np
import pandas as pd

from zambahola_beta.webapp import AppConfig, AppState, compute_signal


def _daily(close, start="2020-01-01"):
    close = np.asarray(close, float)
    n = len(close)
    return pd.DataFrame(
        {
            "open_time": pd.date_range(start, periods=n, freq="D", tz="UTC"),
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": close * 1.01,
            "low": close * 0.99,
            "close": close,
            "volume": np.full(n, 100.0),
            "quote_volume": np.full(n, 100.0) * close,
            "trades": np.full(n, 100.0),
            "taker_buy_base": np.full(n, 50.0),
        }
    )


def test_compute_signal_uptrend_invests():
    up = 100 * np.cumprod(1 + np.full(400, 0.004))
    frames = {"BTCUSDT": _daily(up), "ETHUSDT": _daily(up * 0.5)}
    sig = compute_signal(frames, mode="ensemble", target_vol=0.6)
    assert set(sig["targets"]) == {"BTCUSDT", "ETHUSDT"}
    # strong uptrend -> some allocation (not all cash)
    assert sum(sig["targets"].values()) > 0
    assert "reasons" in sig and "cash_weight" in sig


def test_compute_signal_downtrend_goes_cash():
    down = 100 * np.cumprod(1 + np.full(400, -0.004))
    frames = {"BTCUSDT": _daily(down)}
    sig = compute_signal(frames, mode="ensemble", target_vol=0.6)
    assert sig["targets"]["BTCUSDT"] == 0.0
    assert sig["cash_weight"] == 1.0


def test_appconfig_defaults_safe():
    cfg = AppConfig()
    assert cfg.live is False  # testnet by default
    assert cfg.max_total_usd <= 1000


def test_appstate_log_caps_history():
    st = AppState()
    for i in range(150):
        st.log(f"event {i}")
    assert len(st.actions) == 100
    assert "event 149" in st.actions[-1]
