"""Maker (limit-order) execution analysis.

The order-flow edge is real but ~0.3-0.5 bps/trade — far below taker fees. The
only way to monetize it is as a *maker* (posting limit orders, capturing the
spread, paying maker fees/rebates). Faithfully simulating maker fills needs L3
queue data we don't have, so instead of inventing a fill model we bound reality
with two transparent scenarios using the REAL recorded spread, and report the
break-even cost. Honesty over false precision.

Scenarios (returns measured mid-to-mid as `ret`, spread from recorded data):
- optimistic (both sides maker): capture full spread, pay 2x maker fee.
    net = pos*ret + spread - 2*maker_fee
- conservative (maker entry, taker exit): spread benefit cancels, pay maker+taker.
    net = pos*ret - maker_fee - taker_fee
Truth lies between. We also report the gross edge in bps and the break-even
round-trip cost (the max cost the edge can absorb).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import Config


def _decide(p_up: np.ndarray, long_thr: float, short_thr: float) -> np.ndarray:
    pos = np.zeros(len(p_up), dtype=float)
    pos[p_up >= long_thr] = 1.0
    pos[p_up <= short_thr] = -1.0
    return pos


def maker_eval(
    oos: pd.DataFrame,
    cfg: Config,
    *,
    maker_fee_bps: float = 1.0,
    taker_fee_bps: float | None = None,
) -> dict:
    """Bound the maker economics of the strategy on out-of-sample bars.

    `oos` needs columns p_up, ret, and spread_bps (carried from the data).
    """
    if taker_fee_bps is None:
        taker_fee_bps = cfg.fee_bps
    df = oos.sort_index()
    if not cfg.overlapping:
        df = df.iloc[:: cfg.horizon]

    p_up = df["p_up"].to_numpy()
    ret = df["ret"].to_numpy()
    spread = (df["spread_bps"].to_numpy() if "spread_bps" in df.columns else np.zeros(len(df))) / 1e4
    pos = _decide(p_up, cfg.long_threshold, cfg.short_threshold)
    traded = pos != 0.0

    gross = pos * ret
    maker_fee = maker_fee_bps / 1e4
    taker_fee = taker_fee_bps / 1e4

    net_opt = gross + np.where(traded, spread - 2 * maker_fee, 0.0)
    net_con = gross + np.where(traded, -(maker_fee + taker_fee), 0.0)

    g = gross[traded]
    n = int(traded.sum())
    gross_bps = float(g.mean() * 1e4) if n else 0.0
    spread_bps_mean = float(spread[traded].mean() * 1e4) if n else 0.0

    return {
        "n_trades": n,
        "gross_edge_bps": gross_bps,
        "mean_spread_bps": spread_bps_mean,
        "breakeven_roundtrip_bps": gross_bps,  # cost the edge can absorb
        "taker_net_return": float((gross - np.where(traded, 2 * taker_fee, 0.0)).sum()),
        "maker_net_optimistic": float(net_opt.sum()),
        "maker_net_conservative": float(net_con.sum()),
        "maker_expectancy_opt_bps": float(net_opt[traded].mean() * 1e4) if n else 0.0,
        "maker_expectancy_con_bps": float(net_con[traded].mean() * 1e4) if n else 0.0,
        "maker_fee_bps": maker_fee_bps,
        "taker_fee_bps": taker_fee_bps,
        "verdict": _maker_verdict(net_opt[traded], net_con[traded], n),
    }


def _maker_verdict(net_opt: np.ndarray, net_con: np.ndarray, n: int) -> dict:
    opt_pos = bool(n >= 30 and net_opt.mean() > 0) if n else False
    con_pos = bool(n >= 30 and net_con.mean() > 0) if n else False
    if con_pos:
        note = "Profitable even under the conservative maker model."
    elif opt_pos:
        note = "Profitable only under the optimistic (full spread-capture) maker model."
    else:
        note = "Not profitable even as a maker on this sample."
    return {"maker_profitable_optimistic": opt_pos, "maker_profitable_conservative": con_pos, "note": note}
