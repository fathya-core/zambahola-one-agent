"""Free alternative-data signals for crypto (beyond price).

These are the data layers real crypto quant desks use on top of price:
- Fear & Greed index (alternative.me) — market-wide sentiment, full daily history.
- Funding rate (Binance futures) — crowded-leverage gauge; extreme positive
  funding flags over-leveraged longs (reversal risk). Long history.
- Open interest (Binance futures) — leverage in the system. NOTE: Binance only
  serves ~30 days of OI history, so OI is a LIVE confirm signal, not backtestable.

All free. Each must be validated by backtest before trusting it.
"""

from __future__ import annotations

import time

import pandas as pd
import requests

FNG_URL = "https://api.alternative.me/fng/"
FAPI = "https://fapi.binance.com"


def fetch_fear_greed(limit: int = 0, *, session: requests.Session | None = None) -> pd.DataFrame:
    """Daily Fear & Greed (0=extreme fear, 100=extreme greed). limit=0 -> all history."""
    sess = session or requests.Session()
    r = sess.get(FNG_URL, params={"limit": limit, "format": "json"}, timeout=20)
    r.raise_for_status()
    rows = r.json().get("data", [])
    out = []
    for d in rows:
        try:
            ts = pd.to_datetime(int(d["timestamp"]), unit="s", utc=True).normalize()
            out.append({"date": ts, "fng": int(d["value"])})
        except (KeyError, TypeError, ValueError):
            continue
    df = pd.DataFrame(out).drop_duplicates(subset="date").sort_values("date").reset_index(drop=True)
    return df


def fetch_funding_history(
    symbol: str, *, total: int = 3000, session: requests.Session | None = None
) -> pd.DataFrame:
    """Funding rate history (8h) for a perp, aggregated to DAILY mean. Long history."""
    sess = session or requests.Session()
    out: list[dict] = []
    end_time: int | None = None
    remaining = total
    while remaining > 0:
        params = {"symbol": symbol, "limit": min(1000, remaining)}
        if end_time is not None:
            params["endTime"] = end_time
        try:
            r = sess.get(f"{FAPI}/fapi/v1/fundingRate", params=params, timeout=20)
            r.raise_for_status()
            rows = r.json()
        except Exception:  # noqa: BLE001
            break
        if not rows:
            break
        for d in rows:
            out.append({"t": int(d["fundingTime"]), "rate": float(d["fundingRate"])})
        end_time = int(rows[0]["fundingTime"]) - 1
        remaining -= len(rows)
        if len(rows) < params["limit"]:
            break
        time.sleep(0.15)
    if not out:
        return pd.DataFrame(columns=["date", "funding"])
    df = pd.DataFrame(out)
    df["date"] = pd.to_datetime(df["t"], unit="ms", utc=True).dt.normalize()
    daily = df.groupby("date")["rate"].mean().reset_index()
    daily.columns = ["date", "funding"]
    return daily.sort_values("date").reset_index(drop=True)


def fetch_open_interest(symbol: str, *, session: requests.Session | None = None) -> float | None:
    """Current open interest (base units) for a perp. Live confirm signal."""
    sess = session or requests.Session()
    try:
        r = sess.get(f"{FAPI}/fapi/v1/openInterest", params={"symbol": symbol}, timeout=15)
        r.raise_for_status()
        return float(r.json()["openInterest"])
    except Exception:  # noqa: BLE001
        return None


def fetch_oi_history(
    symbol: str, *, period: str = "1d", limit: int = 30, session: requests.Session | None = None
) -> pd.DataFrame:
    """Open-interest history (Binance serves only ~30 days). For live/recent use."""
    sess = session or requests.Session()
    try:
        r = sess.get(f"{FAPI}/futures/data/openInterestHist",
                     params={"symbol": symbol, "period": period, "limit": limit}, timeout=20)
        r.raise_for_status()
        rows = r.json()
    except Exception:  # noqa: BLE001
        return pd.DataFrame(columns=["date", "oi"])
    out = []
    for d in rows:
        try:
            out.append({"date": pd.to_datetime(int(d["timestamp"]), unit="ms", utc=True).normalize(),
                        "oi": float(d["sumOpenInterest"])})
        except (KeyError, TypeError, ValueError):
            continue
    return pd.DataFrame(out).sort_values("date").reset_index(drop=True) if out else pd.DataFrame(columns=["date", "oi"])


def latest_funding(symbol: str, *, session: requests.Session | None = None) -> float | None:
    """Most recent funding rate (live signal)."""
    df = fetch_funding_history(symbol, total=10, session=session)
    if df.empty:
        return None
    return float(df["funding"].iloc[-1])
