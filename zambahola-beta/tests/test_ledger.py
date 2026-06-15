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


def test_win_rate_none_when_no_closed_trades():
    led = Ledger()
    led.record("BUY", "BTCUSDT", usd=100.0, price=100.0)
    assert led.summary()["win_rate"] is None
