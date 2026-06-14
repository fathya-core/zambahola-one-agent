import numpy as np
import pandas as pd

from zambahola_beta.strategy import (
    align_closes,
    compare_portfolios,
    current_allocation,
    portfolio_backtest,
    trend_consensus,
    vol_scale,
    weights_ensemble,
)


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


def _bull_then_crash(up=400, crash=200):
    u = 100 * np.cumprod(1 + np.full(up, 0.005))
    c = u[-1] * np.cumprod(1 + np.full(crash, -0.01))
    return np.concatenate([u, c])


def test_trend_consensus_range_and_direction():
    up = pd.Series(100 * np.cumprod(1 + np.full(300, 0.004)))
    down = pd.Series(100 * np.cumprod(1 + np.full(300, -0.004)))
    cons_up = trend_consensus(up).iloc[-1]
    cons_down = trend_consensus(down).iloc[-1]
    assert 0.0 <= cons_up <= 1.0 and 0.0 <= cons_down <= 1.0
    assert cons_up > cons_down
    assert cons_up == 1.0 and cons_down == 0.0


def test_vol_scale_lower_in_high_vol():
    rng = np.random.default_rng(0)
    calm = pd.Series(100 * np.cumprod(1 + rng.normal(0, 0.005, 300)))
    wild = pd.Series(100 * np.cumprod(1 + rng.normal(0, 0.05, 300)))
    s_calm = vol_scale(calm, 0.6, 30, cap=1.0).iloc[-1]
    s_wild = vol_scale(wild, 0.6, 30, cap=1.0).iloc[-1]
    assert s_calm >= s_wild


def test_weights_nonnegative_and_capped():
    closes = align_closes({"BTCUSDT": _daily(_bull_then_crash()), "ETHUSDT": _daily(_bull_then_crash())})
    w = weights_ensemble(closes, target_vol=0.6, vol_lookback=30, max_total=1.0)
    assert (w.to_numpy() >= -1e-9).all()
    assert (w.sum(axis=1) <= 1.0 + 1e-9).all()


def test_portfolio_backtest_metrics_keys():
    closes = align_closes({"BTCUSDT": _daily(_bull_then_crash())})
    w = weights_ensemble(closes, target_vol=0.6, vol_lookback=30, max_total=1.0)
    m = portfolio_backtest(closes, w, cost_bps=10.0)
    for k in ("cagr", "sharpe", "max_drawdown", "calmar", "final_equity", "avg_exposure"):
        assert k in m


def test_thinking_allocator_beats_hodl_on_calmar():
    # bull-then-crash: the allocator must de-risk -> better Calmar than HODL.
    assets = {"BTCUSDT": _daily(_bull_then_crash()), "ETHUSDT": _daily(_bull_then_crash(up=380, crash=220))}
    table = compare_portfolios(assets, cost_bps=10.0)
    cal = dict(zip(table["strategy"], table["calmar"]))
    hodl = next(v for k, v in cal.items() if k.startswith("HODL"))
    best_smart = max(cal["Ensemble+VolTgt"], cal["Rotation+VolTgt"])
    assert best_smart > hodl


def test_current_allocation_shape():
    assets = {"BTCUSDT": _daily(_bull_then_crash()), "ETHUSDT": _daily(_bull_then_crash())}
    alloc = current_allocation(assets, mode="ensemble")
    assert set(alloc["targets"].keys()) == {"BTCUSDT", "ETHUSDT"}
    assert "reasons" in alloc and "cash_weight" in alloc
    for r in alloc["reasons"].values():
        assert "action" in r and "trend_consensus" in r
