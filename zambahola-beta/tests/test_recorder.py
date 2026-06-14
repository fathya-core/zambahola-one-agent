from zambahola_beta.recorder import (
    MICRO_COLUMNS,
    MicroBarBuilder,
    book_features,
    cont_ofi,
    load_micro,
    parse_message,
    save_micro,
    synthetic_micro,
)


def test_parse_depth_message():
    msg = {"stream": "btcusdt@depth20@100ms", "data": {"bids": [["100", "2"]], "asks": [["101", "3"]]}}
    kind, bids, asks = parse_message(msg)
    assert kind == "depth"
    assert bids == [(100.0, 2.0)] and asks == [(101.0, 3.0)]


def test_parse_trade_message_buyer_maker():
    msg = {"stream": "btcusdt@aggTrade", "data": {"e": "aggTrade", "p": "100.5", "q": "1.5", "m": True}}
    kind, price, qty, is_maker = parse_message(msg)
    assert kind == "trade" and price == 100.5 and qty == 1.5 and is_maker is True


def test_book_features_basic():
    bids = [(100.0, 4.0)] + [(99.0 - i, 1.0) for i in range(19)]
    asks = [(101.0, 1.0)] + [(102.0 + i, 1.0) for i in range(19)]
    bf = book_features(bids, asks)
    assert bf["mid"] == 100.5
    assert bf["imb1"] > 0  # more bid size at L1
    # microprice tilts toward the ask when bid size dominates
    assert bf["microprice"] > bf["mid"]
    assert bf["spread_bps"] > 0


def test_cont_ofi_signs():
    base = {"best_bid": 100.0, "bid_sz": 2.0, "best_ask": 101.0, "ask_sz": 2.0}
    # bid price up -> strong positive OFI
    up = {"best_bid": 100.5, "bid_sz": 3.0, "best_ask": 101.0, "ask_sz": 2.0}
    assert cont_ofi(base, up) > 0
    # ask price down (sellers stepping in) -> negative OFI
    down = {"best_bid": 100.0, "bid_sz": 2.0, "best_ask": 100.5, "ask_sz": 3.0}
    assert cont_ofi(base, down) < 0


def test_micro_bar_builder_emits_on_boundary():
    b = MicroBarBuilder(bar_ms=1000)
    bids = [(100.0, 2.0)] * 20
    asks = [(101.0, 2.0)] * 20
    assert b.add_book(1000, bids, asks) is None  # first bar opens
    assert b.add_book(1500, bids, asks) is None  # same bar
    b.add_trade(1600, 100.5, 1.0, False)  # buy aggressor
    row = b.add_book(2000, bids, asks)  # crosses into next bar -> emit prev
    assert row is not None
    assert row["ts"] == 1000
    assert row["trade_signed_vol"] == 1.0
    assert row["n_book"] == 2
    assert set(row.keys()) == set(MICRO_COLUMNS)


def test_synthetic_micro_schema():
    df = synthetic_micro(n=500, seed=1)
    assert list(df.columns) == MICRO_COLUMNS
    assert len(df) == 500
    assert (df["high"] >= df["low"]).all()


def test_rotating_parts_merge_on_load(tmp_path):
    df = synthetic_micro(n=20, seed=1)
    # write two non-overlapping rotating parts (like the resilient recorder)
    save_micro(df.iloc[:10].to_dict("records"), tmp_path, "BTCUSDT", tag="sess_0000")
    save_micro(df.iloc[10:].to_dict("records"), tmp_path, "BTCUSDT", tag="sess_0001")
    merged = load_micro(tmp_path)
    assert len(merged) == 20
    assert merged["ts"].is_monotonic_increasing
