"""Safe Binance spot executor for the trend-allocation strategy.

Safety is the whole point here:
- **Testnet by default** (https://testnet.binance.vision, fake money). Live
  requires BOTH --live AND env ZAMBAHOLA_I_ACCEPT_REAL_TRADING=RISK.
- **Dry-run by default**: prints the intended orders, places nothing, unless
  --execute is passed.
- **Keys never in the repo**: loaded at runtime from env vars
  (BINANCE_API_KEY / BINANCE_API_SECRET) or a file path in ZAMBAHOLA_KEYS_FILE
  that lives OUTSIDE the repo. Keys are never logged (only masked).
- **Spot only, no leverage**, symbol whitelist, per-order and total caps,
  min-notional checks. There is no "guaranteed profit" — this just follows the
  validated trend signal with strict risk limits.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

import requests

# Binance API keys/secrets are 64-char alphanumeric ASCII tokens.
_TOKEN_RE = re.compile(r"[A-Za-z0-9]{50,72}")

TESTNET_BASE = "https://testnet.binance.vision"
LIVE_BASE = "https://api.binance.com"


# ---------- keys (never logged) ----------

@dataclass
class Keys:
    api_key: str
    api_secret: str


def mask(secret: str) -> str:
    if not secret:
        return "<empty>"
    return f"{secret[:3]}...{secret[-2:]} (len {len(secret)})"


def load_keys(testnet: bool = False) -> Keys:
    """Load keys for the requested network (env vars first, then a file).

    Testnet and live use DIFFERENT keys (testnet keys come from
    testnet.binance.vision). Resolution order:

    - testnet: BINANCE_TESTNET_API_KEY/SECRET -> ZAMBAHOLA_TESTNET_KEYS_FILE,
      then falls back to the live vars below (back-compat).
    - live:    BINANCE_API_KEY/SECRET -> ZAMBAHOLA_KEYS_FILE.

    File may be JSON {"apiKey","secret"} / {"api_key","api_secret"}, or
    KEY=VALUE lines, or two non-empty lines (key then secret).
    """
    if testnet:
        ek = os.environ.get("BINANCE_TESTNET_API_KEY")
        es = os.environ.get("BINANCE_TESTNET_API_SECRET")
    else:
        ek = os.environ.get("BINANCE_API_KEY")
        es = os.environ.get("BINANCE_API_SECRET")
    if ek and es:
        return Keys(ek.strip(), es.strip())

    if testnet:
        path = os.environ.get("ZAMBAHOLA_TESTNET_KEYS_FILE") or os.environ.get("ZAMBAHOLA_KEYS_FILE")
    else:
        path = os.environ.get("ZAMBAHOLA_KEYS_FILE")

    if not path:
        which = "testnet" if testnet else "live"
        env_hint = ("BINANCE_TESTNET_API_KEY/SECRET or ZAMBAHOLA_TESTNET_KEYS_FILE"
                    if testnet else "BINANCE_API_KEY/SECRET or ZAMBAHOLA_KEYS_FILE")
        raise RuntimeError(
            f"No {which} keys: set {env_hint} to a file OUTSIDE the repo. "
            "Keys are never stored in the project."
        )
    text = Path(path).read_text(encoding="utf-8").strip()
    keys = _parse_keys_text(text)
    _validate(keys)
    return keys


def _parse_keys_text(text: str) -> Keys:
    text = text.strip()
    # 1) clean JSON
    if text.startswith("{"):
        try:
            d = json.loads(text)
            key = d.get("apiKey") or d.get("api_key") or d.get("key")
            secret = d.get("secret") or d.get("api_secret") or d.get("apiSecret")
            if key and secret:
                return Keys(str(key).strip(), str(secret).strip())
        except json.JSONDecodeError:
            pass
    # 2) extract the two long alphanumeric tokens (robust to Arabic/labels/quotes)
    tokens = _TOKEN_RE.findall(text)
    if len(tokens) >= 2:
        return Keys(tokens[0], tokens[1])
    # 3) KEY=VALUE
    kv: dict[str, str] = {}
    for line in text.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            kv[k.strip().upper()] = v.strip()
    key = kv.get("BINANCE_API_KEY") or kv.get("API_KEY") or kv.get("KEY")
    secret = kv.get("BINANCE_API_SECRET") or kv.get("API_SECRET") or kv.get("SECRET")
    if key and secret:
        return Keys(key, secret)
    # 4) two non-empty lines
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) >= 2:
        return Keys(lines[0], lines[1])
    raise RuntimeError("Could not parse keys file (expected JSON, KEY=VALUE, or the two 64-char tokens)")


def _validate(keys: Keys) -> None:
    for label, val in (("API key", keys.api_key), ("API secret", keys.api_secret)):
        if not val.isascii():
            raise RuntimeError(
                f"{label} contains non-ASCII characters — the keys file likely has labels/Arabic "
                "text mixed in. Put just the two 64-char tokens (or KEY=VALUE / JSON) in the file."
            )
        if not (50 <= len(val) <= 72):
            raise RuntimeError(
                f"{label} length {len(val)} is unusual (Binance keys are 64 chars) — check the file."
            )


# ---------- signing (pure, unit-tested against Binance's published vector) ----------

def sign_query(query: str, secret: str) -> str:
    return hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()


# ---------- client ----------

class BinanceSpot:
    def __init__(self, keys: Keys, *, testnet: bool = True, recv_window: int = 5000):
        self.keys = keys
        self.base = TESTNET_BASE if testnet else LIVE_BASE
        self.recv_window = recv_window
        self.session = requests.Session()
        self.session.headers.update({"X-MBX-APIKEY": keys.api_key})

    def _signed(self, method: str, path: str, params: dict) -> dict:
        params = {**params, "timestamp": int(time.time() * 1000), "recvWindow": self.recv_window}
        query = urllib.parse.urlencode(params)
        query += "&signature=" + sign_query(query, self.keys.api_secret)
        url = f"{self.base}{path}?{query}"
        resp = self.session.request(method, url, timeout=15)
        if resp.status_code >= 400:
            # surface Binance's {code, msg} instead of a bare HTTP error
            try:
                err = resp.json()
                raise RuntimeError(f"Binance {err.get('code')}: {err.get('msg')}")
            except ValueError:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    def price(self, symbol: str) -> float:
        r = self.session.get(f"{self.base}/api/v3/ticker/price", params={"symbol": symbol}, timeout=15)
        r.raise_for_status()
        return float(r.json()["price"])

    def all_prices(self) -> dict[str, float]:
        """Every symbol's price in ONE request (public). Avoids N per-symbol calls."""
        r = self.session.get(f"{self.base}/api/v3/ticker/price", timeout=15)
        r.raise_for_status()
        out: dict[str, float] = {}
        for d in r.json():
            try:
                out[d["symbol"]] = float(d["price"])
            except (KeyError, TypeError, ValueError):
                continue
        return out

    def balances(self) -> dict[str, float]:
        acct = self._signed("GET", "/api/v3/account", {})
        return {b["asset"]: float(b["free"]) for b in acct.get("balances", []) if float(b["free"]) > 0}

    def market_order(self, symbol: str, side: str, *, quote_qty: float | None = None,
                     quantity: float | None = None) -> dict:
        # quoteOrderQty works for BOTH BUY and SELL on spot MARKET orders and
        # avoids LOT_SIZE/precision filters (no need to round base quantity).
        params: dict = {"symbol": symbol, "side": side, "type": "MARKET"}
        if quote_qty is not None:
            params["quoteOrderQty"] = round(quote_qty, 2)
        elif quantity is not None:
            params["quantity"] = quantity
        else:
            raise ValueError("need quote_qty or quantity")
        return self._signed("POST", "/api/v3/order", params)


# ---------- rebalance planning (pure) ----------

@dataclass
class RiskLimits:
    max_order_usd: float = 20.0
    max_total_usd: float = 100.0
    min_notional_usd: float = 10.0
    whitelist: tuple[str, ...] = ("BTCUSDT", "ETHUSDT")
    quote: str = "USDT"


@dataclass
class Order:
    symbol: str
    side: str
    usd: float
    reason: str = ""


@dataclass
class RebalancePlan:
    equity_usd: float
    deployable_usd: float
    orders: list[Order] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def plan_rebalance(
    targets: dict[str, float],
    balances: dict[str, float],
    prices: dict[str, float],
    limits: RiskLimits,
) -> RebalancePlan:
    """Compute spot orders to move toward target weights, within risk limits."""
    quote = limits.quote
    quote_bal = balances.get(quote, 0.0)
    holdings_usd = {}
    for sym in limits.whitelist:
        base = sym.replace(quote, "")
        holdings_usd[sym] = balances.get(base, 0.0) * prices.get(sym, 0.0)
    equity = quote_bal + sum(holdings_usd.values())
    deployable = min(equity, limits.max_total_usd)

    plan = RebalancePlan(equity_usd=round(equity, 2), deployable_usd=round(deployable, 2))
    avail_quote = quote_bal  # track so total BUYs never exceed cash on hand
    # SELL first (frees cash), then BUY — and do larger deltas first
    order_syms = sorted(
        limits.whitelist,
        key=lambda s: (targets.get(s, 0.0) * deployable) - holdings_usd.get(s, 0.0),
    )
    for sym in order_syms:
        if sym not in prices or prices[sym] <= 0:
            plan.notes.append(f"{sym}: no price, skipped")
            continue
        target_w = max(0.0, min(1.0, targets.get(sym, 0.0)))
        target_usd = target_w * deployable
        delta = target_usd - holdings_usd[sym]
        if abs(delta) < limits.min_notional_usd:
            continue
        if delta > 0:  # BUY — clamp to per-order cap AND cash actually available
            usd = min(delta, limits.max_order_usd, avail_quote * 0.99)
            if usd < limits.min_notional_usd:
                plan.notes.append(f"{sym}: want BUY but insufficient {quote}")
                continue
            avail_quote -= usd
            side = "BUY"
        else:  # SELL — clamp to per-order cap AND what we actually hold
            usd = min(-delta, limits.max_order_usd, holdings_usd[sym] * 0.99)
            if usd < limits.min_notional_usd:
                continue
            side = "SELL"
        plan.orders.append(Order(symbol=sym, side=side, usd=round(usd, 2),
                                 reason=f"target {target_w:.0%} -> {side}"))
    return plan


def safety_gate(*, live: bool) -> None:
    """Block live trading unless explicitly confirmed via env."""
    if live and os.environ.get("ZAMBAHOLA_I_ACCEPT_REAL_TRADING") != "RISK":
        raise RuntimeError(
            "LIVE trading blocked. Set ZAMBAHOLA_I_ACCEPT_REAL_TRADING=RISK to confirm "
            "real-money orders. (Default is testnet + dry-run.)"
        )
