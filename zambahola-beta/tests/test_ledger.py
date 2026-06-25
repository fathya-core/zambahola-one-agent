"""Tests for the realized-PnL ledger."""

from __future__ import annotations

from zambahola_beta.ledger import Ledger


def test_buy_then_sell_higher_is_a_win():
    led = Ledger()
    led.record("BUY", "BTCUSDT", usd=1000.0, price=100.0)   # 10 units @ 100
    rec = led.record("SELL", "BTCUSDT", usd=1200.0, price=120.0)  # sell 10 units @ 120
    assert rec["realized"] == 200.0  # (120-100)*10
    assert rec["gain_pct"] == 20.0
    s = led.summary()
    assert s["realized_pnl"] == 200.0 and s["wins"] == 1 and s["losses"] == 0
    assert s["win_rate"] == 100.0


def test_buy_then_sell_lower_is_a_loss():
    led = Ledger()
    led.record("BUY", "ETHUSDT", usd=1000.0, price=100.0)
    rec = led.record("SELL", "ETHUSDT", usd=800.0, price=80.0)
    assert rec["realized"] == -200.0
    s = led.summary()
    assert s["losses"] == 1 and s["wins"] == 0 and s["win_rate"] == 0.0


def test_unrealized_gain_tracks_avg_cost():
    led = Ledger()
    led.record("BUY", "SOLUSDT", usd=500.0, price=50.0)   # 10 @ 50
    led.record("BUY", "SOLUSDT", usd=500.0, price=100.0)  # 5 @ 100 -> avg 66.67
    g = led.unrealized_gain_pct("SOLUSDT", 100.0)
    assert g is not None and 49 < g < 51  # ~+50% vs avg 66.67


def test_partial_sell_keeps_position():
    led = Ledger()
    led.record("BUY", "ADAUSDT", usd=1000.0, price=1.0)  # 1000 @ 1
    led.record("SELL", "ADAUSDT", usd=300.0, price=1.5)  # sell 200 @ 1.5
    pos = led.positions["ADAUSDT"]
    assert round(pos.qty, 2) == 800.0  # 1000 - 200 left
    assert round(pos.avg, 4) == 1.0    # avg cost unchanged on partial sell


def test_profit_lock_ratchet():
    led = Ledger()
    led.record("BUY", "SYNUSDT", usd=1000.0, price=1.0)   # entry @1, peak=1
    led.update_peaks({"SYNUSDT": 2.0})                     # ran to +100%, peak=2
    # back to 1.7 = +70% gain but -15% off peak -> armed (>=25%) + giveback (>=12%) -> exit
    assert "SYNUSDT" in led.profit_lock_exits({"SYNUSDT": 1.7}, 0.25, 0.12)
    # still at the peak -> no give-back -> hold
    assert led.profit_lock_exits({"SYNUSDT": 2.0}, 0.25, 0.12) == []


def test_profit_lock_not_armed_for_small_winner():
    led = Ledger()
    led.record("BUY", "XUSDT", usd=100.0, price=1.0)
    led.update_peaks({"XUSDT": 1.10})            # only +10% (below the 25% arm)
    # gave back to flat, but never armed -> no forced exit
    assert led.profit_lock_exits({"XUSDT": 1.0}, 0.25, 0.12) == []


def test_win_rate_none_when_no_closed_trades():
    led = Ledger()
    led.record("BUY", "BTCUSDT", usd=100.0, price=100.0)
    assert led.summary()["win_rate"] is None


def test_entry_clock_stamped_on_fresh_buy_and_cleared_on_exit():
    led = Ledger()
    led.record("BUY", "SYNUSDT", usd=100.0, price=1.0)
    pos = led.positions["SYNUSDT"]
    assert pos.t_entry > 0  # clock stamped
    assert pos.age_hours(now=pos.t_entry + 3600) == 1.0  # one hour later
    led.record("SELL", "SYNUSDT", usd=100.0, price=1.0)  # full exit
    assert led.positions["SYNUSDT"].t_entry == 0.0  # clock cleared for next entry


def test_age_hours_unknown_entry_treated_as_old():
    from zambahola_beta.ledger import Position
    p = Position(qty=1.0, cost=1.0, t_entry=0.0)  # legacy position w/o clock
    assert p.age_hours() > 1e6  # treated as old -> no min-hold protection


def test_risk_exits_cuts_deep_loser_from_cost():
    led = Ledger()
    led.record("BUY", "BICOUSDT", usd=1000.0, price=0.0464)  # entry
    exits = led.risk_exits({"BICOUSDT": 0.0227}, hard_stop_pct=0.15, trail_stop_pct=0.35)
    assert exits["BICOUSDT"][0] == "hard_stop"  # -51% from cost -> cut


def test_risk_exits_holds_shallow_loser():
    led = Ledger()
    led.record("BUY", "XLMUSDT", usd=1000.0, price=0.1928)
    # only -3.6% from cost, not off-peak enough -> no risk exit
    assert led.risk_exits({"XLMUSDT": 0.1859}, hard_stop_pct=0.15, trail_stop_pct=0.35) == {}


def test_risk_exits_trailing_stop_on_rolled_over_winner():
    led = Ledger()
    led.record("BUY", "SYNUSDT", usd=1000.0, price=0.17)
    led.update_peaks({"SYNUSDT": 0.40})  # ran way up, peak=0.40
    # back to 0.25: still +47% vs cost (no hard stop) but -37% off peak -> trailing stop
    exits = led.risk_exits({"SYNUSDT": 0.25}, hard_stop_pct=0.15, trail_stop_pct=0.35)
    assert exits["SYNUSDT"][0] == "trail_stop"


def test_risk_exits_dumps_stablecoin():
    led = Ledger()
    led.record("BUY", "RLUSDUSDT", usd=640.0, price=1.0008)
    exits = led.risk_exits({"RLUSDUSDT": 1.0015}, hard_stop_pct=0.15, trail_stop_pct=0.35,
                           stables={"RLUSDUSDT"})
    assert exits["RLUSDUSDT"][0] == "stable"
