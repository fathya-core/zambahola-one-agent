"""Trade ledger + realized-PnL engine.

Tracks positions with average cost basis so we get a real, auditable record:
realized PnL per round-trip, win/loss count, win rate, and open-position value.
Pure logic in `Ledger`; thin JSON persistence on top.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path


def _data_dir() -> Path:
    return Path(os.environ.get("ZAMBAHOLA_DATA_DIR", "data"))


def _ledger_path() -> Path:
    return _data_dir() / "ledger.json"


def _trades_path() -> Path:
    return _data_dir() / "trades.jsonl"


@dataclass
class Position:
    qty: float = 0.0
    cost: float = 0.0  # total USD cost basis of the current qty
    peak: float = 0.0  # highest price seen since entry (for the profit ratchet)
    t_entry: float = 0.0  # epoch seconds of first entry (for min-hold anti-churn)

    @property
    def avg(self) -> float:
        return self.cost / self.qty if self.qty > 1e-12 else 0.0

    def age_hours(self, now: float | None = None) -> float:
        if self.t_entry <= 0:
            return 1e9  # unknown entry time -> treat as old (no protection)
        return ((now or time.time()) - self.t_entry) / 3600.0


@dataclass
class Ledger:
    positions: dict[str, Position] = field(default_factory=dict)
    realized: float = 0.0
    wins: int = 0
    losses: int = 0

    def record(self, side: str, symbol: str, usd: float, price: float, *, t: str | None = None) -> dict:
        """Apply a fill; return the trade record (with realized PnL for SELLs)."""
        stamp = t or time.strftime("%Y-%m-%d %H:%M:%S")
        pos = self.positions.setdefault(symbol, Position())
        qty = (usd / price) if price > 0 else 0.0
        realized = 0.0
        gain_pct = None
        side = side.upper()
        if side == "BUY":
            if pos.qty <= 1e-12:  # fresh entry -> stamp the clock for min-hold
                pos.t_entry = time.time()
            pos.qty += qty
            pos.cost += usd
            pos.peak = max(pos.peak, price) if pos.peak > 0 else price
        else:  # SELL
            sell_qty = min(qty, pos.qty)
            avg = pos.avg
            if avg > 0 and sell_qty > 0:
                realized = (price - avg) * sell_qty
                gain_pct = round((price / avg - 1.0) * 100, 2)
                pos.cost -= avg * sell_qty
                pos.qty -= sell_qty
                self.realized += realized
                if realized > 0:
                    self.wins += 1
                elif realized < 0:
                    self.losses += 1
                if pos.qty <= 1e-12:  # fully closed -> clear peak/clock for next entry
                    pos.peak = 0.0
                    pos.t_entry = 0.0
        return {
            "t": stamp, "side": side, "symbol": symbol,
            "usd": round(usd, 2), "price": price,
            "realized": round(realized, 2), "gain_pct": gain_pct,
        }

    def update_peaks(self, prices: dict) -> None:
        """Track each open position's running high (for the profit ratchet)."""
        for sym, p in self.positions.items():
            px = prices.get(sym, 0.0)
            if px > 0 and p.qty > 1e-12:
                p.peak = max(p.peak, px)

    def profit_lock_exits(self, prices: dict, arm_pct: float, giveback_pct: float,
                          giveback_map: dict | None = None) -> list[str]:
        """Positions that ran up >= arm_pct then gave back from their peak -> sell
        to LOCK the gain near the high. The give-back threshold is per-position
        (giveback_map, volatility-adaptive) so a wild coin gets room and a calm
        coin locks tight — fully automatic, no fixed number."""
        gm = giveback_map or {}
        out = []
        for sym, p in self.positions.items():
            if p.qty <= 1e-12 or p.avg <= 0 or p.peak <= 0:
                continue
            px = prices.get(sym, 0.0)
            if px <= 0:
                continue
            gain = px / p.avg - 1.0
            from_peak = px / p.peak - 1.0
            gb = gm.get(sym, giveback_pct)
            if gain >= arm_pct and from_peak <= -gb:
                out.append(sym)
        return out

    def risk_exits(self, prices: dict, hard_stop_pct: float, trail_stop_pct: float,
                   stables: set | tuple = ()) -> dict:
        """Positions to force-sell for RISK reasons — independent of the scan
        universe, so a crashed buy that left the top-N still gets stopped out.
        Returns {symbol: (code, value)} where code in {stable, hard_stop, trail_stop}."""
        stset = set(stables)
        out: dict[str, tuple[str, float]] = {}
        for s, p in self.positions.items():
            if p.qty <= 1e-12 or p.avg <= 0:
                continue
            px = prices.get(s, 0.0)
            if px <= 0:
                continue
            gain = px / p.avg - 1.0
            frompk = (px / p.peak - 1.0) if p.peak > 0 else 0.0
            if s in stset:
                out[s] = ("stable", 0.0)
            elif gain <= -abs(hard_stop_pct):
                out[s] = ("hard_stop", gain)
            elif p.peak > 0 and frompk <= -abs(trail_stop_pct):
                out[s] = ("trail_stop", frompk)
        return out

    def unrealized_gain_pct(self, symbol: str, price: float) -> float | None:
        """Current open-position gain vs average cost (for profit-taking)."""
        pos = self.positions.get(symbol)
        if not pos or pos.qty <= 1e-12 or pos.avg <= 0:
            return None
        return (price / pos.avg - 1.0) * 100

    def unrealized(self, prices: dict) -> float:
        """Open-position PnL vs average cost (strategy positions only)."""
        tot = 0.0
        for sym, p in self.positions.items():
            px = prices.get(sym, 0.0)
            if p.qty > 1e-12 and px > 0 and p.avg > 0:
                tot += (px - p.avg) * p.qty
        return tot

    def invested(self) -> float:
        """Cost basis currently deployed in open strategy positions."""
        return sum(p.cost for p in self.positions.values() if p.qty > 1e-12)

    def summary(self, prices: dict | None = None) -> dict:
        n = self.wins + self.losses
        open_pos = {s: {"qty": round(p.qty, 8), "avg": round(p.avg, 6)}
                    for s, p in self.positions.items() if p.qty > 1e-9}
        out = {
            "realized_pnl": round(self.realized, 2),
            "wins": self.wins,
            "losses": self.losses,
            "trades_closed": n,
            "win_rate": round(self.wins / n * 100, 1) if n else None,
            "open_positions": open_pos,
        }
        if prices is not None:
            unreal = self.unrealized(prices)
            invested = self.invested()
            total = self.realized + unreal
            out["unrealized_pnl"] = round(unreal, 2)
            out["invested"] = round(invested, 2)
            out["strategy_pnl"] = round(total, 2)
            out["strategy_pnl_pct"] = round(total / invested * 100, 2) if invested > 1 else None
        return out


def load_ledger() -> Ledger:
    try:
        d = json.loads(_ledger_path().read_text("utf-8"))
        positions = {s: Position(qty=float(v.get("qty", 0)), cost=float(v.get("cost", 0)),
                                 peak=float(v.get("peak", 0)), t_entry=float(v.get("t_entry", 0)))
                     for s, v in d.get("positions", {}).items()}
        return Ledger(positions=positions, realized=float(d.get("realized", 0.0)),
                      wins=int(d.get("wins", 0)), losses=int(d.get("losses", 0)))
    except Exception:  # noqa: BLE001
        return Ledger()


def save_ledger(ledger: Ledger) -> None:
    try:
        p = _ledger_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({
            "positions": {s: {"qty": pos.qty, "cost": pos.cost, "peak": pos.peak,
                              "t_entry": pos.t_entry}
                          for s, pos in ledger.positions.items()},
            "realized": ledger.realized, "wins": ledger.wins, "losses": ledger.losses,
        }), "utf-8")
    except Exception:  # noqa: BLE001
        pass


def append_trade(rec: dict) -> None:
    try:
        p = _trades_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:  # noqa: BLE001
        pass


def load_trades(limit: int = 50) -> list[dict]:
    try:
        lines = _trades_path().read_text("utf-8").splitlines()
        return [json.loads(ln) for ln in lines[-limit:] if ln.strip()]
    except Exception:  # noqa: BLE001
        return []


def reset_ledger() -> None:
    save_ledger(Ledger())
    try:
        _trades_path().unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass
