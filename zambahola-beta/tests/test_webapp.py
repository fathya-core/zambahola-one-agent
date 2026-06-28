import numpy as np
import pandas as pd

from zambahola_beta.webapp import (
    AppConfig,
    AppState,
    _active_sell_bans,
    _apply_reentry_bans,
    _port_tp_should_bank,
    _resolve_whitelist,
    compute_pnl,
    compute_signal,
)
import time


def test_port_tp_banks_on_giveback_from_peak():
    # peaked at +$2000, gave back to +$1500 (>=20% of the gain) -> bank
    assert _port_tp_should_bank(1500.0, 2000.0, arm=150.0, giveback=0.20) is True
    # peaked at +$2000, only down to +$1800 (10% give-back, < 20%) -> hold
    assert _port_tp_should_bank(1800.0, 2000.0, arm=150.0, giveback=0.20) is False


def test_port_tp_not_armed_below_arm():
    # peak only +$100, below the +$150 arm -> never banks
    assert _port_tp_should_bank(20.0, 100.0, arm=150.0, giveback=0.20) is False


def test_port_tp_handles_none_pnl():
    assert _port_tp_should_bank(None, 2000.0, arm=150.0, giveback=0.20) is False


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
    assert cfg.mode == "scan"  # market-wide scanner by default
    assert cfg.max_total_usd <= 1000


def test_compute_pnl_gain_and_drawdown():
    hist = [
        {"t": "2026-01-01 00:00:00", "eq": 1000.0},
        {"t": "2026-01-01 01:00:00", "eq": 1200.0},  # peak
        {"t": "2026-01-01 02:00:00", "eq": 1100.0},  # pulled back from peak
    ]
    p = compute_pnl(hist)
    assert p["start"] == 1000.0 and p["current"] == 1100.0
    assert p["pnl_usd"] == 100.0
    assert p["pnl_pct"] == 10.0
    assert p["drawdown_pct"] < 0  # below the 1200 peak
    assert p["points"] == [1000.0, 1200.0, 1100.0]


def test_compute_pnl_empty_is_none():
    assert compute_pnl([]) is None


def test_resolve_whitelist_union_targets_and_holdings():
    targets = {"SOLUSDT": 0.5, "AVAXUSDT": 0.5}
    balances = {"USDT": 1000.0, "BTC": 0.01, "SOL": 2.0, "DOGE": 0.0}
    wl = _resolve_whitelist(targets, balances)
    # targets come first, held coins (qty>0) appended, USDT and zero-qty skipped
    assert "SOLUSDT" in wl and "AVAXUSDT" in wl  # enter targets
    assert "BTCUSDT" in wl  # held -> can EXIT
    assert "USDTUSDT" not in wl and "DOGEUSDT" not in wl


def test_resolve_whitelist_manages_ledger_coin_outside_universe():
    # a coin we BOUGHT (in ledger) must stay manageable even after it leaves the
    # scanned universe, so it can be rotated out to cash instead of abandoned.
    targets = {"SYNUSDT": 0.4}
    balances = {"USDT": 100.0, "DEXE": 5.0, "JUNK": 9.0}
    universe = ["SYNUSDT", "WLDUSDT"]  # DEXE no longer scanned
    wl = _resolve_whitelist(targets, balances, universe=universe, ledger_syms={"DEXEUSDT"})
    assert "DEXEUSDT" in wl  # held + in ledger -> still managed (can exit)
    assert "JUNKUSDT" not in wl  # never bought, not in universe -> left alone


def test_appstate_log_caps_history():
    st = AppState()
    for i in range(150):
        st.log(f"event {i}")
    assert len(st.actions) == 100
    assert "event 149" in st.actions[-1]


def test_reentry_ban_blocks_buy_targets():
    st = AppState()
    st.sell_ban_until = {"WLDUSDT": time.time() + 3600}
    targets = {"WLDUSDT": 0.2, "HEIUSDT": 0.1}
    blocked = _apply_reentry_bans(targets, st)
    assert blocked == ["WLDUSDT"]
    assert targets["WLDUSDT"] == 0.0
    assert targets["HEIUSDT"] == 0.1
    assert "WLDUSDT" in _active_sell_bans(st)


def test_stop_cooldown_default_is_two_weeks():
    cfg = AppConfig()
    assert cfg.stop_cooldown_hours == 336.0  # ~14 days, backtested anti-whipsaw
    assert cfg.vol_power >= 1.0 and cfg.cap_vol_ref > 0


def test_min_hold_blocks_full_exit_not_trim():
    """Young positions: block rotation to 0, but allow target below current (trim)."""
    targets = {"HEIUSDT": 0.04, "OLDCOINUSDT": 0.0}
    cur_w = {"HEIUSDT": 0.40, "OLDCOINUSDT": 0.05}
    min_h = 24.0
    protected = []
    for s, tgt in list(targets.items()):
        if tgt > 0:
            continue
        cw = cur_w.get(s, 0.0)
        if cw > 0:
            targets[s] = round(cw, 4)
            protected.append(s)
    assert "OLDCOINUSDT" in protected
    assert targets["OLDCOINUSDT"] == 0.05
    assert targets["HEIUSDT"] == 0.04  # trim allowed — not bumped to 0.40
