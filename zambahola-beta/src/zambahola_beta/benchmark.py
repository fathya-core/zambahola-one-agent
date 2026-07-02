"""Local benchmark tracker — honest comparison vs passive alternatives.

Inspired by AI-Trader/TrendRider leaderboard ideas, but fully local: no third-party
platform, no API keys sent anywhere. Updates automatically from equity_history +
public Binance prices.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import requests

_BENCH_SYMBOLS = ("BTCUSDT", "ETHUSDT", "BNBUSDT")
_KLINE_HOSTS = (
    "https://api.binance.com",
    "https://data-api.binance.vision",
    "https://api-gcp.binance.com",
)


def _data_dir() -> Path:
    return Path(os.environ.get("ZAMBAHOLA_DATA_DIR", "data"))


def _equity_path() -> Path:
    return _data_dir() / "equity_history.json"


def _load_equity() -> list[dict]:
    p = _equity_path()
    if not p.exists():
        return []
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        return [h for h in raw if isinstance(h, dict) and "eq" in h]
    except Exception:  # noqa: BLE001
        return []


def _parse_ts(t: str) -> float:
    """Best-effort epoch from 'YYYY-MM-DD HH:MM:SS'."""
    try:
        return time.mktime(time.strptime(t[:19], "%Y-%m-%d %H:%M:%S"))
    except Exception:  # noqa: BLE001
        return 0.0


def _fetch_close_at(symbol: str, target_ts: float) -> float | None:
    """Nearest daily close at or before target_ts (causal — no lookahead)."""
    sess = requests.Session()
    params = {"symbol": symbol, "interval": "1d", "limit": 500}
    for host in _KLINE_HOSTS:
        try:
            r = sess.get(f"{host}/api/v3/klines", params=params, timeout=15)
            r.raise_for_status()
            rows = r.json()
            best = None
            for row in rows:
                open_ms = int(row[0]) / 1000.0
                if open_ms <= target_ts + 86400:  # bar that was open near target
                    best = float(row[4])  # close
            return best
        except Exception:  # noqa: BLE001
            continue
    return None


def _passive_return(symbols: tuple[str, ...], start_ts: float, end_ts: float) -> float | None:
    rets = []
    for sym in symbols:
        p0 = _fetch_close_at(sym, start_ts)
        p1 = _fetch_close_at(sym, end_ts)
        if p0 and p1 and p0 > 0:
            rets.append(p1 / p0 - 1.0)
    if not rets:
        return None
    return sum(rets) / len(rets)


def compute_benchmark() -> dict:
    hist = _load_equity()
    if len(hist) < 2:
        return {"ok": False, "reason": "need >=2 equity snapshots"}

    start_eq = float(hist[0]["eq"])
    end_eq = float(hist[-1]["eq"])
    start_ts = _parse_ts(hist[0].get("t", ""))
    end_ts = _parse_ts(hist[-1].get("t", ""))
    if start_eq <= 0 or start_ts <= 0:
        return {"ok": False, "reason": "invalid equity baseline"}

    strat_ret = end_eq / start_eq - 1.0
    btc_ret = _passive_return(("BTCUSDT",), start_ts, end_ts)
    ew_ret = _passive_return(_BENCH_SYMBOLS, start_ts, end_ts)
    cash_ret = 0.0

    alpha_btc = (strat_ret - btc_ret) if btc_ret is not None else None
    alpha_ew = (strat_ret - ew_ret) if ew_ret is not None else None

    beating = []
    losing = []
    for label, r in (("BTC HODL", btc_ret), ("EW crypto (BTC+ETH+BNB)", ew_ret), ("Cash", cash_ret)):
        if r is None:
            continue
        (beating if strat_ret > r else losing).append(label)

    return {
        "ok": True,
        "since": hist[0].get("t", ""),
        "until": hist[-1].get("t", ""),
        "days": round(max(0.0, (end_ts - start_ts) / 86400.0), 1),
        "strategy_return_pct": round(strat_ret * 100, 3),
        "btc_hodl_pct": round(btc_ret * 100, 3) if btc_ret is not None else None,
        "equal_weight_pct": round(ew_ret * 100, 3) if ew_ret is not None else None,
        "cash_pct": 0.0,
        "alpha_vs_btc_pct": round(alpha_btc * 100, 3) if alpha_btc is not None else None,
        "alpha_vs_ew_pct": round(alpha_ew * 100, 3) if alpha_ew is not None else None,
        "beating": beating,
        "losing": losing,
        "verdict": "outperform" if beating and not losing else (
            "underperform" if losing and not beating else "mixed"),
        "n_snapshots": len(hist),
    }


def refresh_benchmark() -> dict:
    r = compute_benchmark()
    try:
        p = _data_dir() / "BENCHMARK.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    return r
