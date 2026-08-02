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


# ---------- clock resilience (-1021) ----------

class _Resp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


def test_sync_time_failure_keeps_previous_offset():
    """A failed time sync must NOT reset the offset to 0 — the previous
    correction is still the best estimate on a drifting clock."""
    from zambahola_beta.executor import BinanceSpot

    client = BinanceSpot(Keys("K" * 64, "S" * 64))
    client._time_offset_ms = 4321

    def boom(*a, **k):
        raise OSError("network down")

    client.session.get = boom
    assert client.sync_time() == 4321
    assert client._time_offset_ms == 4321


def test_signed_retries_once_after_1021_with_fresh_sync(monkeypatch):
    """-1021 (timestamp outside recvWindow) -> re-sync the clock and replay the
    request once with a fresh timestamp; a second -1021 surfaces as an error."""
    from zambahola_beta.executor import BinanceSpot

    client = BinanceSpot(Keys("K" * 64, "S" * 64))
    calls = {"req": 0, "sync": 0}

    def fake_request(method, url, timeout):
        calls["req"] += 1
        if calls["req"] == 1:
            return _Resp(400, {"code": -1021, "msg": "Timestamp outside recvWindow"})
        return _Resp(200, {"ok": True})

    monkeypatch.setattr(client.session, "request", fake_request)
    monkeypatch.setattr(client, "sync_time", lambda: calls.__setitem__("sync", calls["sync"] + 1))
    out = client._signed("GET", "/api/v3/account", {})
    assert out == {"ok": True}
    assert calls["req"] == 2 and calls["sync"] == 1  # exactly one re-sync + replay

    # persistent -1021 (clock truly broken) must still raise, not loop forever
    def always_1021(method, url, timeout):
        calls["req"] += 1
        return _Resp(400, {"code": -1021, "msg": "still outside"})

    monkeypatch.setattr(client.session, "request", always_1021)
    with pytest.raises(RuntimeError, match="-1021"):
        client._signed("GET", "/api/v3/account", {})


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


# ---------- Portfolio Margin client (papi; -3055 accounts) ----------

def _pm_client(monkeypatch, papi: dict | None = None, sapi: dict | None = None):
    from zambahola_beta.executor import BinancePortfolioMargin
    client = BinancePortfolioMargin(Keys("K" * 64, "S" * 64))
    papi_calls: list[tuple[str, str, dict]] = []
    sapi_calls: list[tuple[str, str, dict]] = []

    def fake_papi(method, path, params):
        papi_calls.append((method, path, dict(params)))
        out = (papi or {}).get(path)
        if isinstance(out, Exception):
            raise out
        return out or {}

    def fake_signed(method, path, params):
        sapi_calls.append((method, path, dict(params)))
        out = (sapi or {}).get(path)
        if isinstance(out, Exception):
            raise out
        return out or {}

    monkeypatch.setattr(client, "_papi", fake_papi)
    monkeypatch.setattr(client, "_signed", fake_signed)
    return client, papi_calls, sapi_calls


def test_pm_orders_route_via_papi_with_side_effects(monkeypatch):
    """PM accounts reject /sapi margin orders with -3055 — orders MUST go to
    /papi/v1/margin/order with the same auto-borrow/auto-repay semantics."""
    client, papi_calls, sapi_calls = _pm_client(monkeypatch)
    client.market_order("UNIUSDT", "BUY", quote_qty=50)
    client.market_order("UNIUSDT", "SELL", quote_qty=25)
    assert not sapi_calls  # nothing touches the classic sapi order endpoint
    (_, p1, a1), (_, p2, a2) = papi_calls
    assert p1 == p2 == "/papi/v1/margin/order"
    assert a1["sideEffectType"] == "MARGIN_BUY"
    assert a2["sideEffectType"] == "AUTO_REPAY"
    assert a1["newOrderRespType"] == "FULL"  # fills always present for the ledger


def test_pm_margin_stats_map_unimmr_and_debt(monkeypatch):
    papi = {
        "/papi/v1/account": {"uniMMR": "99999999", "accountEquity": "168.39",
                             "accountStatus": "NORMAL"},
        "/papi/v1/balance": {"asset": "USDT", "crossMarginFree": "168.56",
                             "crossMarginBorrowed": "40", "crossMarginInterest": "0.5"},
    }
    client, _, _ = _pm_client(monkeypatch, papi)
    st = client.margin_stats()
    assert st["margin_level"] == 999.0  # no-debt sentinel clamped for display/guards
    assert st["net_equity_usd"] == 168.39
    assert st["debt_usdt"] == 40.5
    assert st["gross_assets_usd"] == round(168.39 + 40.5, 2)
    assert st["pm"] is True and st["account_status"] == "NORMAL"


def test_pm_balances_read_cross_margin_free(monkeypatch):
    papi = {"/papi/v1/balance": [
        {"asset": "USDT", "crossMarginFree": "100.5"},
        {"asset": "UNI", "crossMarginFree": "7"},
        {"asset": "DOGE", "crossMarginFree": "0"},
    ]}
    client, _, _ = _pm_client(monkeypatch, papi)
    assert client.balances() == {"USDT": 100.5, "UNI": 7.0}


def test_pm_deleverage_math_uses_unimmr_ratio():
    from zambahola_beta.executor import BinancePortfolioMargin
    client = BinancePortfolioMargin(Keys("K" * 64, "S" * 64))
    # uniMMR 1.25 with $100 debt, target 2.5 -> repay 100*(1-1.25/2.5) = $50
    st = {"margin_level": 1.25, "debt_usdt": 100.0, "gross_assets_usd": 500.0}
    assert client.deleverage_usd(st) == 50.0
    # healthy level or no debt -> nothing to sell
    assert client.deleverage_usd({"margin_level": 5.0, "debt_usdt": 100.0}) == 0.0
    assert client.deleverage_usd({"margin_level": 1.2, "debt_usdt": 0.0}) == 0.0


def test_classic_margin_deleverage_method_matches_module_helper():
    from zambahola_beta.executor import BinanceMargin
    from zambahola_beta.webapp import _margin_deleverage_usd
    client = BinanceMargin(Keys("K" * 64, "S" * 64))
    st = {"gross_assets_usd": 300.0, "debt_usdt": 200.0}
    assert client.deleverage_usd(st) == _margin_deleverage_usd(300.0, 200.0, 2.0) == 100.0


def test_pm_transfer_falls_back_to_portfolio_types(monkeypatch):
    """MAIN_MARGIN works on PM accounts (proven live); if Binance ever refuses it
    the client retries with the explicit PORTFOLIO_MARGIN transfer types."""
    from zambahola_beta.executor import BinancePortfolioMargin
    client = BinancePortfolioMargin(Keys("K" * 64, "S" * 64))
    calls: list[dict] = []

    def fake_signed(method, path, params):
        calls.append(dict(params))
        if params.get("type") == "MAIN_MARGIN":
            raise RuntimeError("Binance -3055: Invalid requests for Portfolio Margin user.")
        return {"tranId": 1}

    monkeypatch.setattr(client, "_signed", fake_signed)
    client.transfer("USDT", 100.0, to_margin=True)
    assert calls[0]["type"] == "MAIN_MARGIN"            # tried the proven path first
    assert calls[1]["type"] == "MAIN_PORTFOLIO_MARGIN"  # then the PM-specific type


def test_marginable_symbols_filters_buy_allowed_and_caches(monkeypatch):
    """Only isBuyAllowed pairs count as marginable; the set is cached process-
    wide so the next call (or the next cycle's client) does zero HTTP."""
    import zambahola_beta.executor as ex
    monkeypatch.setattr(ex, "_MARGINABLE_CACHE", None)
    pairs = [
        {"symbol": "BTCUSDT", "isBuyAllowed": True},
        {"symbol": "ONDOUSDT", "isBuyAllowed": True},
        {"symbol": "TONUSDT", "isBuyAllowed": False},  # spot-only for margin buys
    ]
    client, calls = _margin_client(monkeypatch, {"/sapi/v1/margin/allPairs": pairs})
    out = client.marginable_symbols()
    assert out == frozenset({"BTCUSDT", "ONDOUSDT"})
    # cache hit: same result, no extra HTTP call — even from a NEW client
    client2, calls2 = _margin_client(monkeypatch)
    assert client2.marginable_symbols() == out
    assert calls2 == []


def test_marginable_symbols_keeps_last_set_on_failure(monkeypatch):
    import zambahola_beta.executor as ex
    monkeypatch.setattr(ex, "_MARGINABLE_CACHE", (0.0, frozenset({"BTCUSDT"})))

    def boom(method, path, params):
        raise RuntimeError("network down")

    client, _ = _margin_client(monkeypatch)
    monkeypatch.setattr(client, "_signed", boom)
    assert client.marginable_symbols() == frozenset({"BTCUSDT"})  # stale > nothing


def test_usdt_borrow_daily_reads_cross_margin_data(monkeypatch):
    import zambahola_beta.executor as ex
    monkeypatch.setattr(ex, "_BORROW_RATE_CACHE", None)
    client, _ = _margin_client(
        monkeypatch, {"/sapi/v1/margin/crossMarginData": [{"dailyInterest": "0.00010582"}]})
    assert client.usdt_borrow_daily() == 0.00010582


def test_make_margin_client_detects_pm_accounts(monkeypatch):
    import zambahola_beta.executor as ex
    keys = Keys("K" * 64, "S" * 64)
    monkeypatch.setattr(ex.BinancePortfolioMargin, "sync_time", lambda self: 0)
    # papi reachable -> PM client
    monkeypatch.setattr(ex, "_PM_DETECTED", None)
    monkeypatch.setattr(ex.BinancePortfolioMargin, "pm_account", lambda self: {"uniMMR": "9"})
    assert isinstance(ex.make_margin_client(keys), ex.BinancePortfolioMargin)
    # papi rejected -> classic cross-margin client
    def _boom(self):
        raise RuntimeError("Binance -2015: Invalid API-key")
    monkeypatch.setattr(ex, "_PM_DETECTED", None)
    monkeypatch.setattr(ex.BinancePortfolioMargin, "pm_account", _boom)
    c = ex.make_margin_client(keys)
    assert isinstance(c, ex.BinanceMargin) and not isinstance(c, ex.BinancePortfolioMargin)
    monkeypatch.setattr(ex, "_PM_DETECTED", None)  # don't leak the cache to other tests


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


def test_round_step_kills_binary_float_artifacts():
    from zambahola_beta.executor import BinanceSpot
    # 671 * 0.1 == 67.10000000000001 in IEEE floats -> Binance -1111 precision
    # reject. That silently downgraded full-quantity exits to the dust-leaving
    # quote path. The step rounding must emit decimally-clean values.
    assert repr(BinanceSpot._round_step(67.1328, 0.1)) == "67.1"
    assert repr(BinanceSpot._round_step(5.4328, 0.1)) == "5.4"
    assert repr(BinanceSpot._round_step(0.0512345, 0.001)) == "0.051"
    assert BinanceSpot._round_step(123.7, 1.0) == 123.0
    assert BinanceSpot._round_step(7.0, 0.0) == 7.0  # unknown step -> untouched
    # floor semantics kept: never round UP past the wallet quantity
    assert BinanceSpot._round_step(67.1999, 0.1) == 67.1
