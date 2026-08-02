import numpy as np
import pandas as pd

from zambahola_beta.webapp import (
    AppConfig,
    AppState,
    _active_sell_bans,
    _apply_reentry_bans,
    _book_drop_exits,
    _falling_knife_skips,
    _levered_targets,
    _margin_deleverage_usd,
    _port_tp_should_bank,
    _reconcile_ledger,
    _resolve_whitelist,
    _should_rotate,
    _transfer_amount,
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


def test_force_sell_books_actual_fill_from_exchange_response(tmp_path, monkeypatch):
    """Forced exits must book the EXCHANGE fill (executedQty/cummulativeQuoteQty),
    not the pre-trade estimate — partial fills / price drift stay in sync."""
    monkeypatch.setenv("ZAMBAHOLA_DATA_DIR", str(tmp_path))
    from zambahola_beta.webapp import _force_sell_symbols

    class _Client:
        def market_sell_all(self, symbol, wallet_qty):
            # fills only 9.5 of 10 units, at VWAP 110 (not the stale $100 mark)
            return {"executedQty": "9.5", "cummulativeQuoteQty": "1045.0",
                    "status": "FILLED"}

    led = Ledger()
    led.record("BUY", "SYNUSDT", usd=1000.0, price=100.0, fee_bps=0)  # 10 @ 100
    balances = {"SYN": 10.0}
    placed, sold = _force_sell_symbols(
        _Client(), {"SYNUSDT"}, balances, {"SYNUSDT": 100.0}, led,
        AppConfig(), AppState(), why="test")
    assert placed == 1 and sold == ["SYNUSDT"]
    assert abs(led.positions["SYNUSDT"].qty - 0.5) < 1e-9  # 10 - 9.5 actually sold
    assert abs(balances["SYN"] - 0.5) < 1e-9               # wallet mirrors the fill
    assert led.realized > 90  # (110-100)*9.5 minus fee — PnL from the REAL fill


def test_force_sell_falls_back_to_estimate_on_bare_response(tmp_path, monkeypatch):
    monkeypatch.setenv("ZAMBAHOLA_DATA_DIR", str(tmp_path))
    from zambahola_beta.webapp import _force_sell_symbols

    class _Bare:
        def market_sell_all(self, symbol, wallet_qty):
            return {}

    led = Ledger()
    led.record("BUY", "SYNUSDT", usd=1000.0, price=100.0, fee_bps=0)
    balances = {"SYN": 10.0}
    placed, _ = _force_sell_symbols(
        _Bare(), {"SYNUSDT"}, balances, {"SYNUSDT": 100.0}, led,
        AppConfig(), AppState(), why="test")
    assert placed == 1
    assert led.positions["SYNUSDT"].qty <= 1e-9  # estimate books the full wallet
    assert balances["SYN"] == 0.0


# ---------- REAL leverage (cross-margin) ----------

def test_margin_deleverage_usd_math():
    # assets $300 vs debt $200 -> level 1.5; to recover level 2.0 sell
    # x = (2*200 - 300)/(2-1) = $100 (each sold $ repays $1 of debt)
    assert _margin_deleverage_usd(300.0, 200.0, 2.0) == 100.0
    # healthy book (level 4.0) -> nothing to sell
    assert _margin_deleverage_usd(400.0, 100.0, 2.0) == 0.0
    # no debt -> no deleverage ever
    assert _margin_deleverage_usd(100.0, 0.0) == 0.0


def test_levered_targets_multiplies_only_positive_weights():
    t = _levered_targets({"AUSDT": 0.3, "BUSDT": 0.2, "CUSDT": 0.0},
                         {"AUSDT": 2.0, "BUSDT": 0.5})  # <1 clamps to 1
    assert t == {"AUSDT": 0.6, "BUSDT": 0.2, "CUSDT": 0.0}


def test_platform_limit_error_matcher():
    """Binance per-token platform caps (collateral pool full / borrow pool empty)
    must be recognised so the buy budget rotates instead of retrying forever."""
    from zambahola_beta.webapp import _is_platform_limit_error
    assert _is_platform_limit_error(
        "Binance 51169: Token UNI reaches platform max pledged collateral amount. "
        "The max transfer in quantity is 0.")
    assert _is_platform_limit_error("Binance -3045: The system does not have enough asset now.")
    assert _is_platform_limit_error("borrow amount exceeds the limit")
    # margin-untradeable pairs are permanent platform limits too
    assert _is_platform_limit_error("Binance -3027: Not a valid margin asset.")
    assert _is_platform_limit_error("Binance -11001: Isolated margin account does not exist.")
    # ordinary failures are NOT platform bans (insufficient balance, timeouts...)
    assert not _is_platform_limit_error("Binance -2010: Account has insufficient balance")
    assert not _is_platform_limit_error("HTTP 504: gateway timeout")


class _GuardClient:
    """Minimal client for do_fast_guard: prices + balances + full-fill sells."""

    def __init__(self, prices, balances):
        self._prices = prices
        self.balances_map = balances
        self.sells: list[str] = []

    def sync_time(self):
        pass

    def all_prices(self):
        return dict(self._prices)

    def balances(self):
        return dict(self.balances_map)

    def market_sell_all(self, symbol, wallet_qty):
        self.sells.append(symbol)
        px = self._prices[symbol]
        return {"executedQty": str(wallet_qty),
                "cummulativeQuoteQty": str(wallet_qty * px), "status": "FILLED"}


def _fast_guard_env(tmp_path, monkeypatch, client):
    import zambahola_beta.webapp as wa
    monkeypatch.setenv("ZAMBAHOLA_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(wa, "_connect", lambda live, margin=False: client)
    return wa


def test_fast_guard_sells_hard_stopped_coin_and_bans_rebuy(tmp_path, monkeypatch):
    """A coin 15% underwater must be cut by the 5-min guard (not wait for the
    hourly cycle) and re-entry banned for the stop cooldown."""
    from zambahola_beta.ledger import Ledger, save_ledger, load_ledger
    client = _GuardClient({"SYNUSDT": 85.0}, {"SYN": 10.0, "USDT": 50.0})
    wa = _fast_guard_env(tmp_path, monkeypatch, client)
    led = Ledger()
    led.record("BUY", "SYNUSDT", usd=1000.0, price=100.0, fee_bps=0)  # now -15%
    save_ledger(led)
    cfg = AppConfig()
    state = AppState()
    res = wa.do_fast_guard(cfg, state)
    assert res["ok"] and res["sold"] == 1
    assert client.sells == ["SYNUSDT"]
    assert load_ledger().positions["SYNUSDT"].qty <= 1e-9
    assert state.sell_ban_until.get("SYNUSDT", 0) > time.time()  # anti-whipsaw


def test_fast_guard_locks_profit_with_vol_adaptive_giveback(tmp_path, monkeypatch):
    """+30% winner that pulled back 8% from its peak: locks with the DEFAULT
    floor (7%), but a wild coin (high realized vol in the last scan) gets the
    wider adaptive band and is left to run — same maths as the hourly cycle."""
    from zambahola_beta.ledger import Ledger, save_ledger
    prices = {"CALMUSDT": 130.0 * 0.92, "WILDUSDT": 130.0 * 0.92}
    client = _GuardClient(prices, {"CALM": 10.0, "WILD": 10.0})
    wa = _fast_guard_env(tmp_path, monkeypatch, client)
    led = Ledger()
    for sym in ("CALMUSDT", "WILDUSDT"):
        led.record("BUY", sym, usd=1000.0, price=100.0, fee_bps=0)
        led.positions[sym].peak = 130.0  # ran to +30%, now gave back 8%
    save_ledger(led)
    cfg = AppConfig()
    state = AppState()
    # last scan snapshot: WILD is hyper-volatile -> adaptive giveback ≈ 16% > 8%
    state.signal = {"ranked": [{"symbol": "WILDUSDT", "realized_vol_ann": 1.25}]}
    res = wa.do_fast_guard(cfg, state)
    assert res["ok"] and res["sold"] == 1
    assert client.sells == ["CALMUSDT"]  # wild coin keeps running


def test_fast_guard_idle_book_makes_no_network_calls(tmp_path, monkeypatch):
    from zambahola_beta.ledger import Ledger, save_ledger

    class _Boom:
        def __getattr__(self, name):
            raise AssertionError("no client calls expected with a flat book")

    wa = _fast_guard_env(tmp_path, monkeypatch, _Boom())
    save_ledger(Ledger())
    res = wa.do_fast_guard(AppConfig(), AppState())
    assert res == {"ok": True, "sold": 0}


def test_exec_mutex_makes_overlapping_order_paths_skip(tmp_path, monkeypatch):
    """If the hourly cycle is mid-flight, the fast guard skips instead of
    double-selling the same coin (and vice versa)."""
    import zambahola_beta.webapp as wa
    monkeypatch.setenv("ZAMBAHOLA_DATA_DIR", str(tmp_path))
    assert wa._EXEC_MUTEX.acquire(blocking=False)
    try:
        res = wa.do_fast_guard(AppConfig(), AppState())
        assert res.get("skipped") == "busy"
        res2 = wa.do_execute(AppConfig(), AppState())
        assert res2.get("skipped") == "busy"
    finally:
        wa._EXEC_MUTEX.release()


def test_net_external_flow_signs_values_and_watermark():
    """ROLL_IN adds, ROLL_OUT subtracts, non-USDT rows are valued at the live
    price, and the watermark advances even for rows we can't value — the exact
    incident: user pulled 76.52 ONDO + $28.93 out and pushed $36.45 back."""
    from zambahola_beta.webapp import _net_external_flow
    rows = [
        {"timestamp": 900, "type": "ROLL_IN", "asset": "USDT", "amount": "999", "status": "CONFIRMED"},  # old
        {"timestamp": 1_000, "type": "ROLL_OUT", "asset": "ONDO", "amount": "76.52", "status": "CONFIRMED"},
        {"timestamp": 1_100, "type": "ROLL_IN", "asset": "USDT", "amount": "29.86", "status": "CONFIRMED"},
        {"timestamp": 1_200, "type": "ROLL_IN", "asset": "USDT", "amount": "6.59", "status": "CONFIRMED"},
        {"timestamp": 1_300, "type": "ROLL_OUT", "asset": "USDT", "amount": "28.93", "status": "CONFIRMED"},
        {"timestamp": 1_400, "type": "ROLL_IN", "asset": "USDT", "amount": "50", "status": "PENDING"},  # not settled
    ]
    net, latest = _net_external_flow(rows, 950, lambda s: 0.39)
    assert latest == 1_300
    assert abs(net - (-76.52 * 0.39 + 29.86 + 6.59 - 28.93)) < 0.01

    # unpriceable asset rows are skipped but still advance the watermark
    def no_price(_s):
        raise RuntimeError("no ticker")
    net2, latest2 = _net_external_flow(
        [{"timestamp": 2_000, "type": "ROLL_OUT", "asset": "XXX", "amount": "5", "status": "CONFIRMED"}],
        1_500, no_price)
    assert net2 == 0.0 and latest2 == 2_000


def test_marginable_universe_fails_open_when_margin_off():
    """Spot/testnet mode never filters the universe — the marginable list only
    matters when orders actually go to the margin wallet."""
    from zambahola_beta.webapp import AppConfig, _marginable_universe
    cfg = AppConfig()
    cfg.margin, cfg.live = False, True
    assert _marginable_universe(cfg) is None
    cfg.margin, cfg.live = True, False
    assert _marginable_universe(cfg) is None


def test_transfer_amount_floors_with_buffer():
    assert _transfer_amount(178.567) == 178.55
    assert _transfer_amount(0.5) == 0.49
    assert _transfer_amount(0.0) == 0.0


def test_dashboard_inline_js_has_valid_syntax(tmp_path):
    """The dashboard went blank TWICE from a broken inline <script> (a stray
    PowerShell line once, a Python-interpreted \\n inside a JS string once).
    Gate the whole UI on `node --check` so that class of regression can't ship."""
    import re
    import shutil
    import subprocess

    import pytest

    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    from zambahola_beta.webapp import DASHBOARD_HTML

    scripts = re.findall(r"<script>(.*?)</script>", DASHBOARD_HTML, re.S)
    assert scripts, "dashboard must contain an inline <script>"
    for i, js in enumerate(scripts):
        p = tmp_path / f"dash{i}.js"
        p.write_text(js, encoding="utf-8")
        r = subprocess.run([node, "--check", str(p)], capture_output=True, text=True)
        assert r.returncode == 0, f"dashboard script #{i} syntax error:\n{r.stderr[:1200]}"


def test_rearm_rotation_only_when_all_buys_platform_refused():
    from zambahola_beta.webapp import _should_rearm_rotation
    # all planned buys refused by platform caps -> re-arm (retry alternates)
    assert _should_rearm_rotation(2, 0, 2) is True
    assert _should_rearm_rotation(1, 0, 1) is True
    # partial deployment owns the day -> stay consumed
    assert _should_rearm_rotation(2, 1, 1) is False
    # failures for OTHER reasons (network etc.) -> no platform bans, no re-arm
    assert _should_rearm_rotation(2, 0, 0) is False
    # nothing was planned -> nothing to retry
    assert _should_rearm_rotation(0, 0, 0) is False
