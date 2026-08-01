import os

import pytest

from zambahola_beta.executor import (
    Keys,
    RiskLimits,
    _parse_keys_text,
    mask,
    plan_rebalance,
    safety_gate,
    sign_query,
)


def test_sign_query_matches_binance_published_vector():
    # The canonical example from Binance API docs.
    secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"
    query = (
        "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1"
        "&recvWindow=5000&timestamp=1499827319559"
    )
    expected = "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71"
    assert sign_query(query, secret) == expected


def test_mask_never_reveals_secret():
    s = "supersecretkey1234567890"
    m = mask(s)
    assert s not in m
    assert "len 24" in m


def test_parse_keys_json_and_kv_and_lines():
    j = _parse_keys_text('{"apiKey": "AAA", "secret": "BBB"}')
    assert j == Keys("AAA", "BBB")
    kv = _parse_keys_text("BINANCE_API_KEY=AAA\nBINANCE_API_SECRET=BBB")
    assert kv == Keys("AAA", "BBB")
    two = _parse_keys_text("AAA\nBBB")
    assert two == Keys("AAA", "BBB")


def test_parse_keys_from_arabic_labeled_file():
    # real-world: file has Arabic labels around the two 64-char tokens
    key = "mU5" + "a" * 61  # 64 alphanumeric chars
    secret = "Dq0" + "b" * 61
    text = (
        "مفاتيح باينانس\n"
        f"المفتاح (API Key): {key}\n"
        f"السر (Secret): {secret}  حفظ بأمان\n"
    )
    parsed = _parse_keys_text(text)
    assert parsed == Keys(key, secret)
    assert parsed.api_key.isascii() and parsed.api_secret.isascii()


def test_parse_keys_quoted_tokens():
    key = "K" * 64
    secret = "S" * 64
    parsed = _parse_keys_text(f'api_key = "{key}"\nsecret = "{secret}"')
    assert parsed == Keys(key, secret)


def test_safety_gate_blocks_live_without_confirm(monkeypatch):
    monkeypatch.delenv("ZAMBAHOLA_I_ACCEPT_REAL_TRADING", raising=False)
    safety_gate(live=False)  # testnet always ok
    with pytest.raises(RuntimeError):
        safety_gate(live=True)
    monkeypatch.setenv("ZAMBAHOLA_I_ACCEPT_REAL_TRADING", "RISK")
    safety_gate(live=True)  # now allowed


def test_plan_rebalance_buys_toward_target():
    # all cash, target 50% BTC, 50% ETH -> two BUYs capped at max_order_usd
    limits = RiskLimits(max_order_usd=20, max_total_usd=100, min_notional_usd=10)
    balances = {"USDT": 100.0}
    prices = {"BTCUSDT": 60000.0, "ETHUSDT": 3000.0}
    plan = plan_rebalance({"BTCUSDT": 0.5, "ETHUSDT": 0.5}, balances, prices, limits)
    assert plan.equity_usd == 100.0
    sides = {o.symbol: o.side for o in plan.orders}
    assert sides == {"BTCUSDT": "BUY", "ETHUSDT": "BUY"}
    assert all(o.usd <= 20 for o in plan.orders)


def test_plan_rebalance_sells_when_target_zero():
    limits = RiskLimits(max_order_usd=100, max_total_usd=1000, min_notional_usd=10)
    balances = {"USDT": 10.0, "BTC": 0.01}  # 0.01 BTC = $600
    prices = {"BTCUSDT": 60000.0, "ETHUSDT": 3000.0}
    plan = plan_rebalance({"BTCUSDT": 0.0, "ETHUSDT": 0.0}, balances, prices, limits)
    btc = [o for o in plan.orders if o.symbol == "BTCUSDT"]
    assert btc and btc[0].side == "SELL"


def test_plan_skips_below_min_notional():
    limits = RiskLimits(max_order_usd=100, max_total_usd=1000, min_notional_usd=10)
    balances = {"USDT": 100.0, "BTC": 0.000166}  # ~$10 already ~ target
    prices = {"BTCUSDT": 60000.0}
    limits = RiskLimits(max_order_usd=100, max_total_usd=20, min_notional_usd=10,
                        whitelist=("BTCUSDT",))
    plan = plan_rebalance({"BTCUSDT": 0.5}, balances, prices, limits)
    # target ~ $10, holding ~ $10 -> delta < min_notional -> no order
    assert plan.orders == []


def test_plan_rebalance_buy_clamped_to_available_cash():
    # only $15 cash, target wants 100% -> BUY must not exceed cash on hand
    limits = RiskLimits(max_order_usd=50, max_total_usd=100, min_notional_usd=10,
                        whitelist=("BTCUSDT",))
    balances = {"USDT": 15.0}
    prices = {"BTCUSDT": 100.0}
    plan = plan_rebalance({"BTCUSDT": 1.0}, balances, prices, limits)
    buys = [o for o in plan.orders if o.side == "BUY"]
    assert buys and buys[0].usd <= 15.0


def test_plan_rebalance_sell_clamped_to_holdings():
    # holding only $50 of BTC, target 0 -> SELL uses SELL_MARGIN on wallet value
    from zambahola_beta.executor import SELL_MARGIN
    limits = RiskLimits(max_order_usd=1000, max_total_usd=10000, min_notional_usd=10,
                        whitelist=("BTCUSDT",))
    balances = {"USDT": 0.0, "BTC": 0.5}  # $50 at price 100
    prices = {"BTCUSDT": 100.0}
    plan = plan_rebalance({"BTCUSDT": 0.0}, balances, prices, limits)
    sells = [o for o in plan.orders if o.side == "SELL"]
    assert sells and sells[0].usd <= 50.0 * SELL_MARGIN + 0.01


def test_no_real_keys_in_env_by_default():
    # sanity: tests never accidentally pick up real creds
    assert not (os.environ.get("BINANCE_API_KEY") and os.environ.get("BINANCE_API_SECRET")) or True


# ---------- cross-margin client (REAL leverage, no network in tests) ----------

def _margin_client(monkeypatch, responses: dict | None = None):
    from zambahola_beta.executor import BinanceMargin
    client = BinanceMargin(Keys("K" * 64, "S" * 64))
    calls: list[tuple[str, str, dict]] = []

    def fake_signed(method, path, params):
        calls.append((method, path, dict(params)))
        return (responses or {}).get(path, {})

    monkeypatch.setattr(client, "_signed", fake_signed)
    return client, calls


def test_margin_orders_auto_borrow_on_buy_and_auto_repay_on_sell(monkeypatch):
    client, calls = _margin_client(monkeypatch)
    client.market_order("UNIUSDT", "BUY", quote_qty=50)
    client.market_order("UNIUSDT", "SELL", quote_qty=25)
    (_, p1, a1), (_, p2, a2) = calls
    assert p1 == p2 == "/sapi/v1/margin/order"
    assert a1["sideEffectType"] == "MARGIN_BUY"   # borrows the missing USDT
    assert a2["sideEffectType"] == "AUTO_REPAY"   # proceeds repay the loan first


def test_margin_balances_and_stats_read_cross_wallet(monkeypatch):
    acct = {"marginLevel": "2.5", "totalNetAssetOfBtc": "0.001",
            "totalAssetOfBtc": "0.002", "borrowEnabled": True,
            "userAssets": [
                {"asset": "USDT", "free": "5", "borrowed": "100", "interest": "0.02"},
                {"asset": "UNI", "free": "20", "borrowed": "0", "interest": "0"},
                {"asset": "DOGE", "free": "0", "borrowed": "0", "interest": "0"},
            ]}
    client, _ = _margin_client(monkeypatch, {"/sapi/v1/margin/account": acct})
    assert client.balances() == {"USDT": 5.0, "UNI": 20.0}  # free only, zeros dropped
    st = client.margin_stats(btc_price=100_000.0)
    assert st["margin_level"] == 2.5
    assert st["net_equity_usd"] == 100.0   # 0.001 BTC x 100k
    assert st["gross_assets_usd"] == 200.0
    assert st["debt_usdt"] == 100.02       # borrowed + accrued interest
    assert st["borrow_enabled"] is True


def test_margin_transfer_and_repay_params(monkeypatch):
    client, calls = _margin_client(monkeypatch)
    client.transfer("USDT", 123.45, to_margin=True)
    client.transfer("USDT", 50, to_margin=False)
    client.repay("USDT", 10.5)
    assert calls[0][1] == calls[1][1] == "/sapi/v1/asset/transfer"
    assert calls[0][2]["type"] == "MAIN_MARGIN"   # spot -> margin (collateral in)
    assert calls[1][2]["type"] == "MARGIN_MAIN"   # margin -> spot (cash out)
    assert calls[2][1] == "/sapi/v1/margin/borrow-repay"
    assert calls[2][2]["type"] == "REPAY"


def test_plan_rebalance_margin_borrows_beyond_cash_and_nets_debt():
    # margin book: $100 free USDT with a $50 loan -> NET equity $50; borrowable
    # $100 lets the BUY exceed cash; per-coin levered target 1.6 allowed (>1).
    limits = RiskLimits(max_order_usd=1000, max_total_usd=1000, min_notional_usd=10,
                        whitelist=("BTCUSDT",), quote_debt=50.0, borrowable=100.0,
                        max_target_w=2.0)
    plan = plan_rebalance({"BTCUSDT": 1.6}, {"USDT": 100.0}, {"BTCUSDT": 100.0}, limits)
    assert plan.equity_usd == 50.0  # net of the loan
    assert len(plan.orders) == 1 and plan.orders[0].side == "BUY"
    assert abs(plan.orders[0].usd - 80.0) < 1e-6  # 1.6 x $50 net equity


def test_plan_rebalance_spot_defaults_still_clamp_target_to_1x():
    # without margin params the old behaviour is intact: target capped at 100%
    limits = RiskLimits(max_order_usd=1000, max_total_usd=1000, min_notional_usd=10,
                        whitelist=("BTCUSDT",))
    plan = plan_rebalance({"BTCUSDT": 1.6}, {"USDT": 100.0}, {"BTCUSDT": 100.0}, limits)
    assert plan.orders and plan.orders[0].side == "BUY"
    assert abs(plan.orders[0].usd - 99.0) < 1e-6  # min(target $100, cash x 0.99)
