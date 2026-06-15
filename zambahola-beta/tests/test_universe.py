"""Tests for the market-wide trend scanner."""

from __future__ import annotations

import numpy as np
import pandas as pd

from zambahola_beta.universe import (
    fetch_top_symbols,
    market_regime,
    scan,
    trend_score,
)


def _frame(values: np.ndarray) -> pd.DataFrame:
    t = pd.date_range("2023-01-01", periods=len(values), freq="D")
    return pd.DataFrame({"open_time": t, "close": values})


def _frames() -> dict[str, pd.DataFrame]:
    n = 260
    up = np.linspace(100.0, 300.0, n)        # strong uptrend, high momentum
    up_mild = np.linspace(100.0, 150.0, n)   # mild uptrend, lower momentum
    down = np.linspace(300.0, 100.0, n)      # downtrend -> should be cash
    return {"UPUSDT_X": _frame(up), "MILDUSDT": _frame(up_mild), "DOWNUSDT_X": _frame(down)}


def test_trend_score_directions():
    f = _frames()
    up = trend_score(f["UPUSDT_X"]["close"].reset_index(drop=True))
    down = trend_score(f["DOWNUSDT_X"]["close"].reset_index(drop=True))
    assert up["consensus"] >= 0.75 and up["momentum"] > 0
    assert down["consensus"] <= 0.25 and down["momentum"] < 0


def test_scan_picks_uptrends_and_ranks_smart():
    res = scan(_frames(), top_n=5, target_vol=0.6, max_total=1.0)
    assert res["scanned"] == 3
    # downtrend coin must not be funded
    assert "DOWNUSDT_X" not in res["targets"]
    # both uptrends funded, book sums to ~max_total (no BTC leader -> regime 1.0)
    assert set(res["targets"]) == {"UPUSDT_X", "MILDUSDT"}
    assert abs(sum(res["targets"].values()) - 1.0) < 1e-6
    # smart ranking: an invested uptrend on top, the downtrend last and in cash
    assert res["ranked"][0]["action"] == "INVEST"
    assert res["ranked"][-1]["symbol"] == "DOWNUSDT_X"
    assert res["ranked"][-1]["action"] == "CASH"


def test_scan_all_down_goes_cash():
    n = 260
    down = {"AUSDT": _frame(np.linspace(200.0, 100.0, n)),
            "BUSDT": _frame(np.linspace(300.0, 90.0, n))}
    res = scan(down, top_n=5)
    assert res["targets"] == {}
    assert res["cash_weight"] == 1.0


def test_scan_respects_max_total_leverage():
    # no BTC leader in the synthetic basket -> regime 1.0 -> full max_total
    res = scan(_frames(), top_n=5, max_total=2.0)
    assert abs(sum(res["targets"].values()) - 2.0) < 1e-6


def test_market_regime_scales_with_leader():
    n = 260
    up = _frame(np.linspace(100.0, 300.0, n))
    down = _frame(np.linspace(300.0, 100.0, n))
    assert market_regime({"BTCUSDT": up}) > 0.9     # BTC up -> risk on
    assert market_regime({"BTCUSDT": down}) < 0.5   # BTC down -> risk off
    assert market_regime({}) == 1.0                 # unknown -> neutral


def test_scan_regime_cuts_exposure_when_btc_weak():
    n = 260
    frames = {
        "BTCUSDT": _frame(np.linspace(300.0, 100.0, n)),     # market leader DOWN
        "ALTUSDT": _frame(np.linspace(100.0, 320.0, n)),     # a strong alt uptrend
    }
    res = scan(frames, top_n=5, max_total=1.0)
    # alt still funded, but total exposure is scaled down by the risk-off regime
    assert res["regime"] < 0.5
    assert 0 < sum(res["targets"].values()) <= res["regime"] + 1e-6


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _Sess:
    def __init__(self, payload):
        self._payload = payload

    def get(self, *a, **k):
        return _Resp(self._payload)


def test_fetch_top_symbols_filters_and_sorts():
    payload = [
        {"symbol": "BTCUSDT", "quoteVolume": "100"},
        {"symbol": "ETHUSDT", "quoteVolume": "90"},
        {"symbol": "SOLUSDT", "quoteVolume": "80"},
        {"symbol": "USDCUSDT", "quoteVolume": "9999"},   # stablecoin -> excluded
        {"symbol": "BTCUPUSDT", "quoteVolume": "5000"},  # leveraged -> excluded
        {"symbol": "ETHBTC", "quoteVolume": "7000"},     # not USDT -> excluded
    ]
    out = fetch_top_symbols(2, session=_Sess(payload))
    assert out == ["BTCUSDT", "ETHUSDT"]
