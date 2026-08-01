import numpy as np
import pandas as pd

from zambahola_beta.webapp import (
    AppConfig,
    AppState,
    _active_sell_bans,
    _apply_reentry_bans,
    _book_drop_exits,
    _falling_knife_skips,
    _port_tp_should_bank,
    _reconcile_ledger,
    _resolve_whitelist,
    _should_rotate,
    compute_pnl,
    compute_signal,
)
from zambahola_beta.ledger import Ledger, Position
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


def test_reconcile_dust_aligns_silently_without_phantom_trade(tmp_path, monkeypatch):
    # a tiny wallet<ledger gap (exchange lot-size rounding / fee) must NOT book a
    # phantom trade — just quietly align the ledger qty to the wallet
    monkeypatch.setenv("ZAMBAHOLA_DATA_DIR", str(tmp_path))
    led = Ledger(positions={"TIAUSDT": Position(qty=1000.0, cost=100.0, peak=0.11)})
    st = AppState()
    changed = _reconcile_ledger(led, {"TIA": 998.0}, {"TIAUSDT": 0.1}, st)
    assert changed is True
    assert led.positions["TIAUSDT"].qty == 998.0  # aligned down to wallet
    assert led.realized == 0.0                     # no phantom PnL booked
    trades_file = tmp_path / "trades.jsonl"
    assert not trades_file.exists()                # no reconcile-phantom record written


def test_reconcile_books_material_phantom(tmp_path, monkeypatch):
    # a large ledger-ahead-of-wallet gap (a real failed/out-of-band order) IS booked
    # as a reconcile-phantom sell so risk logic stops acting on the ghost
    monkeypatch.setenv("ZAMBAHOLA_DATA_DIR", str(tmp_path))
    led = Ledger(positions={"SYNUSDT": Position(qty=1000.0, cost=100.0, peak=0.11)})
    st = AppState()
    changed = _reconcile_ledger(led, {"SYN": 0.0}, {"SYNUSDT": 0.1}, st)
    assert changed is True
    assert led.positions["SYNUSDT"].qty <= 1e-9    # ghost fully closed
    trades_file = tmp_path / "trades.jsonl"
    assert trades_file.exists()
    assert "reconcile-phantom" in trades_file.read_text(encoding="utf-8")


def test_min_hold_allows_exit_when_dropped_from_book():
    """Young position the signal dropped from picks -> min_hold must NOT block exit."""
    targets = {"OLDCOINUSDT": 0.0}
    sig_targets = {"HEIUSDT": 0.04}  # OLDCOIN not in scan book
    cur_w = {"OLDCOINUSDT": 0.05}
    protected = []
    for s, tgt in list(targets.items()):
        if tgt > 0:
            continue
        if s not in sig_targets:
            continue  # dropped from book -> allow exit
        cw = cur_w.get(s, 0.0)
        if cw > 0:
            targets[s] = round(cw, 4)
            protected.append(s)
    assert protected == []
    assert targets["OLDCOINUSDT"] == 0.0


def test_min_hold_blocks_full_exit_not_trim():
    """Young positions: block rotation to 0, but allow target below current (trim)."""
    targets = {"HEIUSDT": 0.04, "OLDCOINUSDT": 0.0}
    cur_w = {"HEIUSDT": 0.40, "OLDCOINUSDT": 0.05}
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


def test_falling_knife_blocks_stale_entry():
    """A NEW pick that already crashed below the decision candle is skipped to cash."""
    targets = {"EPICUSDT": 0.10, "ALLOUSDT": 0.06}
    close_ref = {"EPICUSDT": 0.728, "ALLOUSDT": 0.351}
    prices = {"EPICUSDT": 0.553, "ALLOUSDT": 0.357}  # EPIC -24% vs close, ALLO +2%
    knifed = _falling_knife_skips(targets, close_ref, prices, held=set(), max_gap=0.10)
    assert targets["EPICUSDT"] == 0.0          # falling knife -> blocked
    assert targets["ALLOUSDT"] == 0.06         # healthy -> untouched
    assert any("EPIC" in k for k in knifed)


def test_falling_knife_leaves_held_positions_alone():
    """A coin we already hold is never zeroed by the entry guard (exits manage it)."""
    targets = {"EPICUSDT": 0.10}
    close_ref = {"EPICUSDT": 0.728}
    prices = {"EPICUSDT": 0.553}
    knifed = _falling_knife_skips(targets, close_ref, prices,
                                  held={"EPICUSDT"}, max_gap=0.10)
    assert targets["EPICUSDT"] == 0.10  # held -> untouched
    assert knifed == []


def test_rotate_gate_blocks_same_candle():
    """Anti-churn: same candle as last rotation -> no rotation (protection still runs)."""
    stamp = "2026-07-11 00:00:00+00:00"
    assert _should_rotate(stamp, stamp, force=False) is False


def test_rotate_gate_allows_new_candle():
    """A new daily candle closed -> rotation is allowed."""
    assert _should_rotate("2026-07-12 00:00:00+00:00",
                          "2026-07-11 00:00:00+00:00", force=False) is True


def test_rotate_gate_force_overrides():
    """Manual execute button forces rotation even on the same candle."""
    stamp = "2026-07-11 00:00:00+00:00"
    assert _should_rotate(stamp, stamp, force=True) is True


def test_rotate_gate_fails_open_without_stamp():
    """No candle stamp (unknown) -> act rather than freeze."""
    assert _should_rotate("", "whatever", force=False) is True


def test_book_drop_exit_sells_coin_that_left_the_picks():
    """A held coin no longer in the book must exit promptly (ATM stuck -4% bug)."""
    held = {"ATMUSDT", "DEXEUSDT", "UNIUSDT"}
    book = {"DEXEUSDT", "UNIUSDT", "AAVEUSDT"}
    assert _book_drop_exits(held, book, exclude=set()) == {"ATMUSDT"}


def test_book_drop_exit_keeps_in_book_positions():
    """Coins still among the picks are NOT force-exited (trims stay gated)."""
    held = {"DEXEUSDT", "UNIUSDT"}
    book = {"DEXEUSDT", "UNIUSDT", "AAVEUSDT"}
    assert _book_drop_exits(held, book, exclude=set()) == set()


def test_book_drop_exit_skips_coins_already_stopped():
    """A coin already handled by a stop/lock exit is excluded (no double-sell)."""
    held = {"ATMUSDT", "ZECUSDT"}
    book = {"DEXEUSDT"}
    assert _book_drop_exits(held, book, exclude={"ZECUSDT"}) == {"ATMUSDT"}



# ---------------------------------------------------------------- small-capital consolidation

def test_consolidate_small_targets_merges_subnotional_into_fillable():
    from zambahola_beta.webapp import _consolidate_small_targets
    # COTI at 4% of a $180 book = $7.2 < $11 -> dropped, weight moved to A/B
    targets = {"AUSDT": 0.30, "BUSDT": 0.15, "COTIUSDT": 0.04}
    dropped = _consolidate_small_targets(targets, equity_usd=180.0, min_usd=11.0,
                                         held=set(), cap_w=0.35)
    assert dropped == ["COTIUSDT"]
    assert targets["COTIUSDT"] == 0.0
    assert targets["AUSDT"] > 0.30 and targets["BUSDT"] > 0.15
    assert targets["AUSDT"] <= 0.35 + 1e-9
    assert abs(sum(targets.values()) - 0.49) < 0.01  # freed weight redeployed, not lost


def test_consolidate_small_targets_leaves_held_trims_alone():
    from zambahola_beta.webapp import _consolidate_small_targets
    # a HELD coin with a small target is a TRIM instruction - must not be zeroed
    targets = {"AUSDT": 0.30, "HELDUSDT": 0.04}
    dropped = _consolidate_small_targets(targets, 180.0, 11.0, {"HELDUSDT"}, 0.35)
    assert dropped == []
    assert targets["HELDUSDT"] == 0.04


def test_consolidate_small_targets_respects_cap_leftover_to_cash():
    from zambahola_beta.webapp import _consolidate_small_targets
    # the only fillable pick is already at cap -> freed weight stays cash
    targets = {"AUSDT": 0.35, "BUSDT": 0.05}
    dropped = _consolidate_small_targets(targets, 100.0, 11.0, set(), 0.35)
    assert dropped == ["BUSDT"]
    assert targets["AUSDT"] == 0.35
    assert targets["BUSDT"] == 0.0


def test_live_load_config_clamps_leverage_to_1x(tmp_path, monkeypatch):
    import json as _json
    import zambahola_beta.webapp as wa
    p = tmp_path / "config.json"
    p.write_text(_json.dumps({"max_total": 3.0}), "utf-8")
    monkeypatch.setattr(wa, "_config_path", lambda: p)
    cfg = wa.AppConfig(live=True)
    wa._load_config(cfg)
    assert cfg.max_total == 1.0  # live spot: leverage neutralised
    cfg2 = wa.AppConfig(live=False)
    wa._load_config(cfg2)
    assert cfg2.max_total == 3.0  # testnet keeps it (experiments allowed)
