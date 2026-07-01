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
    # disable the correlation filter here (synthetic linear coins are ~identical)
    res = scan(_frames(), top_n=5, target_vol=0.6, max_total=1.0, max_correlation=1.0, min_vol=0.0)
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


def test_vol_power_shifts_weight_away_from_hypervol_coin():
    """A higher vol_power should reduce the weight share of a very volatile coin
    relative to a calmer uptrend of similar trend strength."""
    n = 260
    rng = np.random.default_rng(0)
    calm = np.linspace(100.0, 240.0, n) * (1 + rng.normal(0, 0.005, n)).cumprod()
    wild = np.linspace(100.0, 240.0, n) * (1 + rng.normal(0, 0.06, n)).cumprod()
    frames = {"CALMUSDT": _frame(calm), "WILDUSDT": _frame(wild)}

    def share(vp):
        r = scan(frames, top_n=2, target_vol=0.6, max_total=1.0, max_correlation=1.0,
                 min_vol=0.0, min_consensus=0.0, vol_power=vp)
        t = r["targets"]
        tot = sum(t.values()) or 1.0
        return t.get("WILDUSDT", 0.0) / tot

    low = share(1.0)
    high = share(2.5)
    # stronger vol penalty -> wild coin gets a smaller slice of the book
    assert high <= low + 1e-9


def test_vol_aware_cap_tightens_ceiling_for_volatile_coin():
    """cap_vol_ref shrinks the per-coin ceiling for a coin whose vol exceeds the ref."""
    n = 260
    rng = np.random.default_rng(1)
    calm = np.linspace(100.0, 260.0, n) * (1 + rng.normal(0, 0.004, n)).cumprod()
    wild = np.linspace(100.0, 320.0, n) * (1 + rng.normal(0, 0.07, n)).cumprod()
    frames = {"CALMUSDT": _frame(calm), "WILDUSDT": _frame(wild)}
    # without vol-aware cap, the strong wild coin can hit the flat 0.5 cap
    base = scan(frames, top_n=2, target_vol=0.6, max_total=1.0, max_correlation=1.0,
                min_vol=0.0, min_consensus=0.0, max_weight=0.5, cap_vol_ref=0.0)
    capped = scan(frames, top_n=2, target_vol=0.6, max_total=1.0, max_correlation=1.0,
                  min_vol=0.0, min_consensus=0.0, max_weight=0.5, cap_vol_ref=1.0)
    assert capped["targets"].get("WILDUSDT", 0.0) <= base["targets"].get("WILDUSDT", 0.0) + 1e-9


def test_scan_concentration_cap_limits_single_weight():
    # with a hard cap, no single coin may exceed max_weight of the book
    res = scan(_frames(), top_n=5, target_vol=0.6, max_total=1.0, max_correlation=1.0,
               min_vol=0.0, max_weight=0.4)
    assert res["targets"]
    assert max(res["targets"].values()) <= 0.4 + 1e-9


def test_scan_skips_coin_rolling_over_short_term():
    # 90d uptrend (consensus high) but the last ~30 bars are falling -> mom30 < 0,
    # so the quality gate must refuse it even though the medium trend is still up.
    n = 260
    base = np.linspace(100.0, 300.0, n - 20)
    dip = np.linspace(300.0, 262.0, 20)
    rollover = np.concatenate([base, dip])
    up = np.linspace(100.0, 320.0, n)
    frames = {"ROLLUSDT": _frame(rollover), "UPUSDT_X": _frame(up)}
    res = scan(frames, top_n=5, max_correlation=1.0, min_vol=0.0)
    assert "UPUSDT_X" in res["targets"]
    assert "ROLLUSDT" not in res["targets"]


def test_trend_score_drawdown_from_high():
    close = pd.Series(np.concatenate([np.linspace(100.0, 300.0, 200),
                                      np.linspace(300.0, 210.0, 30)]))
    s = trend_score(close)
    assert s["dd_high"] <= -0.25  # ~30% below the recent 300 high


def test_scan_trailing_stop_excludes_crashed_coin():
    # rose to a high then fell ~28% off it within the 60-bar window
    close = np.concatenate([
        np.linspace(100.0, 280.0, 160),
        np.linspace(280.0, 360.0, 40),
        np.linspace(360.0, 260.0, 30),
    ])
    res = scan({"CRASHUSDT": _frame(close)}, top_n=5, stop_pct=0.25)
    assert "CRASHUSDT" not in res["targets"]
    row = next(r for r in res["ranked"] if r["symbol"] == "CRASHUSDT")
    assert row["dd_high"] <= -0.25


def test_scan_funded_coins_are_near_highs():
    res = scan(_frames(), stop_pct=0.25, min_vol=0.0)
    for r in res["ranked"]:
        if r["symbol"] in res["targets"]:
            assert r["dd_high"] > -0.25  # never funds a coin past its stop


def test_scan_diversification_skips_correlated():
    rng = np.random.default_rng(0)
    n = 260
    shocks_a = rng.normal(0.005, 0.012, n)          # uptrend + noise
    a = 100 * np.cumprod(1 + shocks_a)
    b = 100 * np.cumprod(1 + shocks_a + rng.normal(0, 0.0004, n))  # ~ same shocks -> corr
    c = 100 * np.cumprod(1 + rng.normal(0.005, 0.012, n))          # independent uptrend
    frames = {"AUSDT": _frame(a), "BUSDT": _frame(b), "CUSDT": _frame(c)}
    res = scan(frames, top_n=2, max_correlation=0.8)
    picks = set(res["targets"])
    # the independent coin is kept; the two near-identical coins aren't both funded
    assert "CUSDT" in picks
    assert not ({"AUSDT", "BUSDT"} <= picks)


def test_scan_hysteresis_keeps_held_coin():
    rng = np.random.default_rng(2)
    n = 260

    def s(drift: float) -> np.ndarray:
        return 100 * np.cumprod(1 + rng.normal(drift, 0.01, n))

    frames = {f"C{i}USDT": _frame(s(0.006 - i * 0.0004)) for i in range(6)}
    base = scan(frames, top_n=4, max_correlation=1.0, held=set())
    # a coin that was eligible but did NOT make the top 4
    eligible = [r["symbol"] for r in base["ranked"] if r["action"] in ("INVEST", "UPTREND")]
    not_picked = [s for s in eligible if s not in base["targets"]]
    assert not_picked, "need an eligible-but-unpicked coin for this test"
    cand = not_picked[0]
    # holding it -> hysteresis keeps it in the book (no churn on a borderline rank)
    kept = scan(frames, top_n=4, max_correlation=1.0, held={cand}, hold_buffer=2)
    assert cand in kept["targets"]


def test_scan_all_down_goes_cash():
    n = 260
    down = {"AUSDT": _frame(np.linspace(200.0, 100.0, n)),
            "BUSDT": _frame(np.linspace(300.0, 90.0, n))}
    res = scan(down, top_n=5)
    assert res["targets"] == {}
    assert res["cash_weight"] == 1.0


def test_scan_respects_max_total_leverage():
    # no BTC leader in the synthetic basket -> regime 1.0 -> full max_total
    res = scan(_frames(), top_n=5, max_total=2.0, max_correlation=1.0, min_vol=0.0)
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
    res = scan(frames, top_n=5, max_total=1.0, min_vol=0.0)
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
    # min_quote_volume=0 to isolate the filter/sort logic from the liquidity floor
    out = fetch_top_symbols(2, min_quote_volume=0.0, session=_Sess(payload))
    assert out == ["BTCUSDT", "ETHUSDT"]


def test_fetch_top_symbols_liquidity_floor_and_ascii():
    payload = [
        {"symbol": "BTCUSDT", "quoteVolume": "80000000"},   # liquid -> kept
        {"symbol": "ETHUSDT", "quoteVolume": "60000000"},   # liquid -> kept
        {"symbol": "THINUSDT", "quoteVolume": "1000000"},   # thin -> dropped
        {"symbol": "币安人生USDT", "quoteVolume": "90000000"},  # non-ascii -> dropped
    ]
    out = fetch_top_symbols(10, min_quote_volume=50_000_000.0, session=_Sess(payload))
    assert out == ["BTCUSDT", "ETHUSDT"]
