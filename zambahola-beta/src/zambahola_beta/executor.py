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
import math
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
PAPI_BASE = "https://papi.binance.com"  # Portfolio Margin (unified account) API


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
        path = _autodetect_keys_file(testnet)  # convenience: find keys on the Desktop

    if not path:
        which = "testnet" if testnet else "live"
        env_hint = ("BINANCE_TESTNET_API_KEY/SECRET or ZAMBAHOLA_TESTNET_KEYS_FILE"
                    if testnet else "BINANCE_API_KEY/SECRET or ZAMBAHOLA_KEYS_FILE")
        raise RuntimeError(
            f"No {which} keys: set {env_hint} to a file OUTSIDE the repo "
            "(or put testnet-keys.txt / binance-API.txt on your Desktop). "
            "Keys are never stored in the project."
        )
    text = Path(path).read_text(encoding="utf-8").strip()
    keys = _parse_keys_text(text)
    _validate(keys)
    return keys


def _autodetect_keys_file(testnet: bool) -> str | None:
    """Last-resort convenience: look for the user's key files on the Desktop so
    the dashboard 'just works' however it's launched. Testnet and live use
    different files; testnet falls back to the live file if no testnet file."""
    home = Path.home()
    desktops = [home / "OneDrive" / "Desktop", home / "Desktop"]
    testnet_names = ["testnet-keys.txt", "binance-testnet.txt", "binance-testnet-API.txt"]
    live_names = ["binance-API.txt", "binance-api.txt", "binance-keys.txt"]
    order = (testnet_names + live_names) if testnet else live_names
    for d in desktops:
        for name in order:
            p = d / name
            if p.exists():
                return str(p)
    return None


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
    # 10s recvWindow (Binance max 60s): tolerant of network jitter and small
    # clock drift between per-cycle syncs, still tight enough against replay.
    def __init__(self, keys: Keys, *, testnet: bool = True, recv_window: int = 10000):
        self.keys = keys
        self.base = TESTNET_BASE if testnet else LIVE_BASE
        self.recv_window = recv_window
        self.session = requests.Session()
        self.session.headers.update({"X-MBX-APIKEY": keys.api_key})
        self._time_offset_ms = 0  # server-clock sync (set via sync_time)
        self._filters: dict[str, dict] = {}  # LOT_SIZE/MIN_NOTIONAL cache per symbol

    def sync_time(self) -> int:
        """Align local clock to Binance server time to avoid -1021 (timestamp
        outside recvWindow) on live orders when the PC clock drifts.

        On failure the PREVIOUS offset is kept: resetting to 0 would assume the
        local clock is perfect — exactly wrong on a machine whose clock already
        needed the correction (e.g. Windows free-running on the CMOS clock)."""
        try:
            r = self.session.get(f"{self.base}/api/v3/time", timeout=10)
            r.raise_for_status()
            server_ms = int(r.json()["serverTime"])
            self._time_offset_ms = server_ms - int(time.time() * 1000)
        except Exception:  # noqa: BLE001
            pass
        return self._time_offset_ms

    def symbol_filters(self, symbol: str) -> dict:
        """Cached LOT_SIZE step + MIN_NOTIONAL for a symbol (real-Binance order
        filters). Needed to sell an EXACT base quantity with no leftover dust."""
        if symbol in self._filters:
            return self._filters[symbol]
        out = {"step": 0.0, "min_qty": 0.0, "min_notional": 0.0}
        try:
            r = self.session.get(f"{self.base}/api/v3/exchangeInfo",
                                 params={"symbol": symbol}, timeout=15)
            r.raise_for_status()
            info = r.json()["symbols"][0]
            for flt in info.get("filters", []):
                ft = flt.get("filterType")
                if ft == "LOT_SIZE":
                    out["step"] = float(flt.get("stepSize", 0) or 0)
                    out["min_qty"] = float(flt.get("minQty", 0) or 0)
                elif ft in ("MIN_NOTIONAL", "NOTIONAL"):
                    out["min_notional"] = float(flt.get("minNotional", 0) or 0)
        except Exception:  # noqa: BLE001
            pass
        self._filters[symbol] = out
        return out

    @staticmethod
    def _round_step(qty: float, step: float) -> float:
        """Floor a base quantity to the symbol's LOT_SIZE step (avoids -1013).

        Binary-float artifacts must be snapped away: 671 * 0.1 in IEEE floats is
        67.10000000000001, which Binance rejects with -1111 (precision over the
        symbol's maximum) — that silently downgraded full-quantity exits to the
        dust-leaving quote path. Quantize to the step's own decimal places."""
        if step <= 0:
            return qty
        q = math.floor(qty / step + 1e-9) * step
        step_txt = f"{step:.10f}".rstrip("0")
        decs = len(step_txt.split(".")[1]) if "." in step_txt else 0
        return round(q, decs)

    def _signed_at(self, base: str, method: str, path: str, params: dict,
                   *, _retry: bool = True) -> dict:
        """Signed request against an explicit host (api / papi share the same
        HMAC scheme and API key — only the base URL differs).

        -1021 (timestamp outside recvWindow) is self-healing: the local clock
        drifted since the last sync (sleep/resume, un-synced Windows clock), so
        re-align once and replay with a fresh timestamp. Safe even for orders —
        -1021 requests are rejected BEFORE any processing, nothing was placed."""
        ts = int(time.time() * 1000) + self._time_offset_ms
        signed = {**params, "timestamp": ts, "recvWindow": self.recv_window}
        query = urllib.parse.urlencode(signed)
        query += "&signature=" + sign_query(query, self.keys.api_secret)
        url = f"{base}{path}?{query}"
        resp = self.session.request(method, url, timeout=15)
        if resp.status_code >= 400:
            # surface Binance's {code, msg} instead of a bare HTTP error
            try:
                err = resp.json()
            except ValueError:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            if err.get("code") == -1021 and _retry:
                self.sync_time()
                return self._signed_at(base, method, path, params, _retry=False)
            raise RuntimeError(f"Binance {err.get('code')}: {err.get('msg')}")
        return resp.json()

    def _signed(self, method: str, path: str, params: dict) -> dict:
        return self._signed_at(self.base, method, path, params)

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
        if quantity is not None:
            params["quantity"] = quantity
        elif quote_qty is not None:
            params["quoteOrderQty"] = round(quote_qty, 2)
        else:
            raise ValueError("need quote_qty or quantity")
        return self._signed("POST", "/api/v3/order", params)

    def market_sell_all(self, symbol: str, wallet_qty: float) -> dict:
        """FULL exit with no leftover: sell the entire base holding by QUANTITY,
        floored to the symbol's LOT_SIZE step. Unlike a quote-qty sell (which we
        under-shoot by SELL_MARGIN to dodge -2010 and thus always leave ~8% dust),
        this liquidates the position cleanly so nothing lingers in the wallet."""
        flt = self.symbol_filters(symbol)
        qty = self._round_step(wallet_qty, flt.get("step", 0.0))
        if qty <= 0:
            raise RuntimeError(f"{symbol}: qty {wallet_qty} below LOT_SIZE step")
        return self.market_order(symbol, "SELL", quantity=qty)


class BinanceMargin(BinanceSpot):
    """CROSS-MARGIN executor — REAL leverage by borrowing, on the same spot pairs.

    The whole point vs `BinanceSpot`: buys can exceed the cash in the wallet.
    - Orders go to /sapi/v1/margin/order with `sideEffectType`:
        BUY  -> MARGIN_BUY  (Binance auto-borrows the missing USDT at fill time)
        SELL -> AUTO_REPAY  (proceeds repay loan + accrued interest first)
      so there is NO manual borrow/repay bookkeeping to get wrong.
    - `balances()` reads the CROSS MARGIN wallet (what's actually sellable there).
    - `margin_stats()` exposes marginLevel / debt / net equity for the liquidation
      guard (Binance margin-calls at level 1.3 and force-liquidates at 1.1).
    Margin exists on LIVE only — testnet.binance.vision has no /sapi margin API —
    so this client is always constructed against the live base URL. The webapp
    safety gate (ZAMBAHOLA_I_ACCEPT_REAL_TRADING=RISK) still applies on top.
    """

    # Liquidation-guard thresholds for the CLASSIC margin level (assets/debt).
    # Binance margin-calls at 1.3 and force-liquidates at 1.1 — we act far above.
    LEVEL_BLOCK_BUYS = 1.8
    LEVEL_DELEVERAGE = 1.4
    LEVEL_TARGET = 2.0

    def __init__(self, keys: Keys, *, recv_window: int = 10000):
        super().__init__(keys, testnet=False, recv_window=recv_window)

    def deleverage_usd(self, stats: dict) -> float:
        """USD of positions to sell (AUTO_REPAY) so the level recovers to
        LEVEL_TARGET. Classic level = assets/debt; selling x repays x of debt:
        (A-x)/(D-x) = T  ->  x = (T*D - A)/(T - 1)."""
        assets = float(stats.get("gross_assets_usd", 0) or 0)
        debt = float(stats.get("debt_usdt", 0) or 0)
        t = self.LEVEL_TARGET
        if debt <= 0 or t <= 1.0:
            return 0.0
        x = (t * debt - assets) / (t - 1.0)
        return round(max(0.0, min(x, assets)), 2)

    # -- account ----------------------------------------------------------
    def margin_account(self) -> dict:
        return self._signed("GET", "/sapi/v1/margin/account", {})

    def balances(self) -> dict[str, float]:
        acct = self.margin_account()
        return {a["asset"]: float(a["free"]) for a in acct.get("userAssets", [])
                if float(a.get("free", 0) or 0) > 0}

    def margin_stats(self, btc_price: float | None = None) -> dict:
        """Liquidation-guard view of the cross-margin account (USD figures)."""
        acct = self.margin_account()
        try:
            lvl = float(acct.get("marginLevel", 999) or 999)
        except (TypeError, ValueError):
            lvl = 999.0
        if btc_price is None:
            try:
                btc_price = self.price("BTCUSDT")
            except Exception:  # noqa: BLE001
                btc_price = 0.0
        debts: dict[str, dict] = {}
        for a in acct.get("userAssets", []):
            b = float(a.get("borrowed", 0) or 0)
            i = float(a.get("interest", 0) or 0)
            if b > 0 or i > 0:
                debts[a["asset"]] = {"borrowed": b, "interest": i}
        u = debts.get("USDT", {})
        return {
            "margin_level": lvl,
            "net_equity_usd": round(float(acct.get("totalNetAssetOfBtc", 0) or 0) * btc_price, 2),
            "gross_assets_usd": round(float(acct.get("totalAssetOfBtc", 0) or 0) * btc_price, 2),
            "debt_usdt": round(u.get("borrowed", 0.0) + u.get("interest", 0.0), 2),
            "debts": debts,
            "borrow_enabled": bool(acct.get("borrowEnabled", False)),
        }

    def max_borrowable(self, asset: str = "USDT") -> float:
        try:
            r = self._signed("GET", "/sapi/v1/margin/maxBorrowable", {"asset": asset})
            return float(r.get("amount", 0) or 0)
        except Exception:  # noqa: BLE001
            return 0.0

    def marginable_symbols(self) -> frozenset[str] | None:
        """Symbols Binance allows BUYING on cross margin — NOT every spot pair is
        marginable, and buying a spot-only symbol in a margin wallet is rejected.
        The list barely changes, so it is cached process-wide for 12h; the read
        endpoint works for Portfolio Margin accounts too (only orders need papi).
        Returns the last known set on failure, or None if never fetched."""
        global _MARGINABLE_CACHE
        now = time.time()
        if _MARGINABLE_CACHE and now - _MARGINABLE_CACHE[0] < 12 * 3600:
            return _MARGINABLE_CACHE[1]
        try:
            rows = self._signed("GET", "/sapi/v1/margin/allPairs", {})
            out = frozenset(r["symbol"] for r in rows if r.get("isBuyAllowed", True))
            if out:
                _MARGINABLE_CACHE = (now, out)
            return out or None
        except Exception:  # noqa: BLE001
            return _MARGINABLE_CACHE[1] if _MARGINABLE_CACHE else None

    def usdt_borrow_daily(self) -> float | None:
        """Current daily interest rate for borrowing USDT (cost transparency;
        cached 12h). E.g. 0.000106 = 0.0106%/day ≈ 3.9%/yr."""
        global _BORROW_RATE_CACHE
        now = time.time()
        if _BORROW_RATE_CACHE and now - _BORROW_RATE_CACHE[0] < 12 * 3600:
            return _BORROW_RATE_CACHE[1]
        try:
            rows = self._signed("GET", "/sapi/v1/margin/crossMarginData", {"coin": "USDT"})
            rate = float(rows[0]["dailyInterest"]) if rows else None
            if rate is not None:
                _BORROW_RATE_CACHE = (now, rate)
            return rate
        except Exception:  # noqa: BLE001
            return _BORROW_RATE_CACHE[1] if _BORROW_RATE_CACHE else None

    # -- orders ------------------------------------------------------------
    def market_order(self, symbol: str, side: str, *, quote_qty: float | None = None,
                     quantity: float | None = None) -> dict:
        params: dict = {"symbol": symbol, "side": side, "type": "MARKET",
                        "sideEffectType": "MARGIN_BUY" if side == "BUY" else "AUTO_REPAY"}
        if quantity is not None:
            params["quantity"] = quantity
        elif quote_qty is not None:
            params["quoteOrderQty"] = round(quote_qty, 2)
        else:
            raise ValueError("need quote_qty or quantity")
        return self._signed("POST", "/sapi/v1/margin/order", params)

    # -- wallet plumbing ----------------------------------------------------
    def transfer(self, asset: str, amount: float, *, to_margin: bool) -> dict:
        """Move funds SPOT <-> CROSS MARGIN (universal transfer; the key already
        permits it). to_margin=True funds the margin wallet as collateral."""
        return self._signed("POST", "/sapi/v1/asset/transfer",
                            {"type": "MAIN_MARGIN" if to_margin else "MARGIN_MAIN",
                             "asset": asset, "amount": round(float(amount), 8)})

    def transfer_history(self, start_ms: int) -> list[dict]:
        """Margin-wallet in/out movements since start_ms (ROLL_IN/ROLL_OUT rows).
        This log catches MANUAL transfers made from the Binance app that the
        universal-transfer query can miss — used to keep performance honest."""
        try:
            out = self._signed("GET", "/sapi/v1/margin/transfer",
                               {"startTime": int(start_ms), "size": 20})
            return out.get("rows", []) or []
        except Exception:  # noqa: BLE001
            return []

    def repay(self, asset: str, amount: float) -> dict:
        """Explicit loan repayment (AUTO_REPAY on sells normally covers this; used
        to clear residual interest when switching margin off)."""
        return self._signed("POST", "/sapi/v1/margin/borrow-repay",
                            {"asset": asset, "isIsolated": "FALSE",
                             "type": "REPAY", "amount": round(float(amount), 8)})


class BinancePortfolioMargin(BinanceMargin):
    """PORTFOLIO MARGIN (unified account) executor — same real borrowing, via papi.

    Accounts enrolled in Binance Portfolio Margin REJECT the classic /sapi margin
    endpoints with error -3055 ("Invalid requests for Portfolio Margin user"):
    orders, borrows and account reads must use https://papi.binance.com instead.
    Same symbols, same sideEffectType semantics (MARGIN_BUY auto-borrows,
    AUTO_REPAY settles debt from proceeds) — only the endpoints and the risk
    metric differ:

    - Risk metric is uniMMR (adjusted equity / maintenance margin), NOT
      assets/debt. Binance: healthy > 1.5, margin-call 1.2..1.5, REDUCE-ONLY
      (new orders refused) 1.05..1.2, liquidation <= 1.05. Our guards act above
      all of these. With no debt Binance reports uniMMR=99999999 (clamped 999).
    - Market data (prices/klines/filters) still comes from api.binance.com via
      the inherited spot methods.
    """

    LEVEL_BLOCK_BUYS = 2.0   # stay above Binance's 1.5 margin-call band
    LEVEL_DELEVERAGE = 1.5   # act at the margin-call line, far above 1.05 liq
    LEVEL_TARGET = 2.5

    def _papi(self, method: str, path: str, params: dict) -> dict:
        return self._signed_at(PAPI_BASE, method, path, params)

    # -- account ----------------------------------------------------------
    def pm_account(self) -> dict:
        return self._papi("GET", "/papi/v1/account", {})

    def balances(self) -> dict[str, float]:
        """Sellable (free) assets in the PM cross-margin wallet."""
        rows = self._papi("GET", "/papi/v1/balance", {})
        if isinstance(rows, dict):  # single-asset response shape
            rows = [rows]
        return {r["asset"]: float(r.get("crossMarginFree", 0) or 0)
                for r in rows if float(r.get("crossMarginFree", 0) or 0) > 0}

    def margin_stats(self, btc_price: float | None = None) -> dict:
        """Liquidation-guard view of the PM account (uniMMR as the level)."""
        acct = self.pm_account()
        try:
            lvl = float(acct.get("uniMMR", 999) or 999)
        except (TypeError, ValueError):
            lvl = 999.0
        lvl = min(lvl, 999.0)  # Binance reports 99999999 when there is no debt
        eq = float(acct.get("accountEquity", 0) or 0)
        debts: dict[str, dict] = {}
        debt_usdt = 0.0
        try:
            u = self._papi("GET", "/papi/v1/balance", {"asset": "USDT"})
            b = float(u.get("crossMarginBorrowed", 0) or 0)
            i = float(u.get("crossMarginInterest", 0) or 0)
            debt_usdt = b + i
            if debt_usdt > 0:
                debts["USDT"] = {"borrowed": b, "interest": i}
        except Exception:  # noqa: BLE001
            pass
        return {
            "margin_level": lvl,
            "net_equity_usd": round(eq, 2),
            "gross_assets_usd": round(eq + debt_usdt, 2),
            "debt_usdt": round(debt_usdt, 2),
            "debts": debts,
            "borrow_enabled": True,
            "pm": True,
            "account_status": acct.get("accountStatus"),
        }

    def max_borrowable(self, asset: str = "USDT") -> float:
        try:
            r = self._papi("GET", "/papi/v1/margin/maxBorrowable", {"asset": asset})
            return float(r.get("amount", 0) or 0)
        except Exception:  # noqa: BLE001
            return 0.0

    def deleverage_usd(self, stats: dict) -> float:
        """PM: uniMMR = equity / maintMargin and maintMargin scales with debt, so
        selling x (AUTO_REPAY) moves the level from L to L*D/(D-x). Recovering to
        LEVEL_TARGET needs x = D * (1 - L/T); equity is unchanged by the swap."""
        debt = float(stats.get("debt_usdt", 0) or 0)
        lvl = float(stats.get("margin_level", 999) or 999)
        t = self.LEVEL_TARGET
        if debt <= 0 or lvl >= t or t <= 0:
            return 0.0
        x = debt * (1.0 - lvl / t)
        cap = float(stats.get("gross_assets_usd", 0) or 0)
        return round(max(0.0, min(x, cap if cap > 0 else x)), 2)

    # -- orders ------------------------------------------------------------
    def market_order(self, symbol: str, side: str, *, quote_qty: float | None = None,
                     quantity: float | None = None) -> dict:
        params: dict = {"symbol": symbol, "side": side, "type": "MARKET",
                        "newOrderRespType": "FULL",  # guarantee executedQty/fills
                        "sideEffectType": "MARGIN_BUY" if side == "BUY" else "AUTO_REPAY"}
        if quantity is not None:
            params["quantity"] = quantity
        elif quote_qty is not None:
            params["quoteOrderQty"] = round(quote_qty, 2)
        else:
            raise ValueError("need quote_qty or quantity")
        return self._papi("POST", "/papi/v1/margin/order", params)

    # -- wallet plumbing ----------------------------------------------------
    def transfer(self, asset: str, amount: float, *, to_margin: bool) -> dict:
        """SPOT <-> PM margin wallet. MAIN_MARGIN works for PM accounts (the PM
        account contains the cross-margin wallet); fall back to the explicit
        PORTFOLIO_MARGIN universal-transfer types if Binance refuses it."""
        try:
            return super().transfer(asset, amount, to_margin=to_margin)
        except RuntimeError:
            t = "MAIN_PORTFOLIO_MARGIN" if to_margin else "PORTFOLIO_MARGIN_MAIN"
            return self._signed("POST", "/sapi/v1/asset/transfer",
                                {"type": t, "asset": asset,
                                 "amount": round(float(amount), 8)})

    def repay(self, asset: str, amount: float) -> dict:
        """Explicit PM loan repayment (papi); falls back to repay-debt."""
        try:
            return self._papi("POST", "/papi/v1/repayLoan",
                              {"asset": asset, "amount": round(float(amount), 8)})
        except RuntimeError:
            return self._papi("POST", "/papi/v1/margin/repay-debt",
                              {"asset": asset, "amount": round(float(amount), 8)})


# module-level caches (survive per-cycle client re-instantiation):
# PM enrollment doesn't change mid-session; marginable pairs / borrow rates
# barely move, so both are refreshed at most every 12h.
_PM_DETECTED: bool | None = None
_MARGINABLE_CACHE: tuple[float, frozenset[str]] | None = None
_BORROW_RATE_CACHE: tuple[float, float] | None = None


def make_margin_client(keys: Keys, *, recv_window: int = 10000) -> BinanceMargin:
    """Return the RIGHT margin executor for this account: Portfolio Margin
    accounts (papi reachable) get BinancePortfolioMargin — classic /sapi margin
    orders would fail for them with -3055; everyone else gets BinanceMargin."""
    global _PM_DETECTED
    if _PM_DETECTED is None:
        probe = BinancePortfolioMargin(keys, recv_window=recv_window)
        probe.sync_time()
        try:
            probe.pm_account()
            _PM_DETECTED = True
        except Exception:  # noqa: BLE001 — not a PM account (or papi unreachable)
            _PM_DETECTED = False
    if _PM_DETECTED:
        return BinancePortfolioMargin(keys, recv_window=recv_window)
    return BinanceMargin(keys, recv_window=recv_window)


# ---------- rebalance planning (pure) ----------

@dataclass
class RiskLimits:
    max_order_usd: float = 20.0
    max_total_usd: float = 100.0
    min_notional_usd: float = 10.0
    rebalance_band: float = 0.0  # skip rebalances smaller than band*position (fee-aware)
    whitelist: tuple[str, ...] = ("BTCUSDT", "ETHUSDT")
    quote: str = "USDT"
    # liquidity-aware sizing: cap each order to `participation` * the coin's 24h
    # quote volume so we never move a size the market can't absorb without slippage.
    participation: float = 0.0  # 0 disables the cap
    vol_usd: dict[str, float] = field(default_factory=dict)  # symbol -> 24h quote vol
    # -- margin (real leverage) — all default to spot behaviour --------------
    quote_debt: float = 0.0    # borrowed quote + interest -> subtracted for NET equity
    borrowable: float = 0.0    # extra quote MARGIN_BUY may auto-borrow beyond cash
    max_target_w: float = 1.0  # per-symbol target clamp (margin passes >1 = levered)

    def order_cap(self, sym: str) -> float:
        """Per-order USD ceiling: the smaller of the flat cap and a participation
        slice of the symbol's daily volume (falls back to the flat cap if unknown)."""
        cap = self.max_order_usd
        v = self.vol_usd.get(sym, 0.0)
        if self.participation > 0 and v > 0:
            cap = min(cap, self.participation * v)
        return cap


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


# margin on SELL quoteOrderQty — absorbs price drift between fetch and fill (Binance -2010)
SELL_MARGIN = 0.92


def plan_rebalance(
    targets: dict[str, float],
    balances: dict[str, float],
    prices: dict[str, float],
    limits: RiskLimits,
) -> RebalancePlan:
    """Compute orders to move toward target weights, within risk limits.

    Works for both spot and cross-margin: with margin, `quote_debt` nets the loan
    out of equity (so weights are % of REAL capital, not of borrowed cash),
    `borrowable` lets total BUYs exceed cash on hand (MARGIN_BUY auto-borrows),
    and `max_target_w` allows a single coin's levered target above 100%."""
    quote = limits.quote
    quote_bal = balances.get(quote, 0.0)
    holdings_usd = {}
    for sym in limits.whitelist:
        base = sym.replace(quote, "")
        holdings_usd[sym] = balances.get(base, 0.0) * prices.get(sym, 0.0)
    equity = quote_bal - limits.quote_debt + sum(holdings_usd.values())
    deployable = min(equity, limits.max_total_usd)

    plan = RebalancePlan(equity_usd=round(equity, 2), deployable_usd=round(deployable, 2))
    avail_quote = quote_bal + limits.borrowable  # cash + what MARGIN_BUY may borrow
    # SELL first (frees cash), then BUY — and do larger deltas first
    order_syms = sorted(
        limits.whitelist,
        key=lambda s: (targets.get(s, 0.0) * deployable) - holdings_usd.get(s, 0.0),
    )
    for sym in order_syms:
        if sym not in prices or prices[sym] <= 0:
            plan.notes.append(f"{sym}: no price, skipped")
            continue
        target_w = max(0.0, min(limits.max_target_w, targets.get(sym, 0.0)))
        target_usd = target_w * deployable
        delta = target_usd - holdings_usd[sym]
        # fee-aware: ignore small drifts (don't churn on noise); always allow full exits
        band = limits.rebalance_band * max(target_usd, holdings_usd[sym])
        threshold = limits.min_notional_usd if target_usd <= 0 else max(limits.min_notional_usd, band)
        if abs(delta) < threshold:
            continue
        cap = limits.order_cap(sym)  # flat cap ∧ liquidity-participation cap
        if delta > 0:  # BUY — clamp to per-order cap AND cash actually available
            usd = min(delta, cap, avail_quote * 0.99)
            if usd < limits.min_notional_usd:
                plan.notes.append(f"{sym}: want BUY but insufficient {quote}")
                continue
            avail_quote -= usd
            side = "BUY"
        else:  # SELL — clamp to per-order cap AND wallet (with margin for -2010)
            usd = min(-delta, cap, holdings_usd[sym] * SELL_MARGIN)
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
