"""Cost-aware backtest.

Turns out-of-sample P(up) into long/short/flat decisions, applies the realized
horizon return, subtracts fees + slippage, and reports edge-after-costs metrics.
This is the gate that decides whether anything is worth taking to a wallet.
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


def run_backtest(oos: pd.DataFrame, cfg: Config) -> dict:
    """`oos` needs columns p_up and ret (realized return over the horizon)."""
    df = oos.sort_index()
    if not cfg.overlapping:
        # Non-overlapping bets: step by horizon so trades don't double-count.
        df = df.iloc[:: cfg.horizon]

    p_up = df["p_up"].to_numpy()
    ret = df["ret"].to_numpy()
    pos = _decide(p_up, cfg.long_threshold, cfg.short_threshold)

    cost_rate = (cfg.fee_bps + cfg.slippage_bps) / 1e4
    # round-trip cost charged on any non-flat position (enter + exit)
    cost = np.where(pos != 0.0, 2.0 * cost_rate, 0.0)

    gross = pos * ret
    net = gross - cost

    traded = pos != 0.0
    n_trades = int(traded.sum())
    metrics = _metrics(net[traded], gross[traded], pos[traded], ret[traded], cfg)
    metrics["n_decisions"] = int(len(df))
    metrics["n_trades"] = n_trades
    metrics["trade_rate"] = float(n_trades / len(df)) if len(df) else 0.0
    metrics["equity_final"] = float(np.prod(1.0 + net)) if len(net) else 1.0
    return metrics


def _metrics(
    net: np.ndarray, gross: np.ndarray, pos: np.ndarray, ret: np.ndarray, cfg: Config
) -> dict:
    if len(net) == 0:
        return {
            "net_return": 0.0, "gross_return": 0.0, "directional_accuracy": float("nan"),
            "win_rate": float("nan"), "avg_win": 0.0, "avg_loss": 0.0,
            "profit_factor": float("nan"), "expectancy": 0.0, "sharpe": float("nan"),
            "sortino": float("nan"), "max_drawdown": 0.0,
        }

    wins = net[net > 0]
    losses = net[net < 0]
    correct_dir = (np.sign(pos) == np.sign(ret)) & (ret != 0.0)

    equity = np.cumprod(1.0 + net)
    peak = np.maximum.accumulate(equity)
    drawdown = (equity - peak) / peak
    max_dd = float(drawdown.min()) if len(drawdown) else 0.0

    std = float(net.std(ddof=1)) if len(net) > 1 else 0.0
    downside = net[net < 0]
    dstd = float(downside.std(ddof=1)) if len(downside) > 1 else 0.0
    ann = np.sqrt(cfg.bars_per_year())
    sharpe = float(net.mean() / std * ann) if std > 0 else float("nan")
    sortino = float(net.mean() / dstd * ann) if dstd > 0 else float("nan")

    gross_profit = float(wins.sum())
    gross_loss = float(-losses.sum())
    profit_factor = float(gross_profit / gross_loss) if gross_loss > 0 else float("inf")

    return {
        "net_return": float(net.sum()),
        "gross_return": float(gross.sum()),
        "directional_accuracy": float(correct_dir.mean()),
        "win_rate": float((net > 0).mean()),
        "avg_win": float(wins.mean()) if len(wins) else 0.0,
        "avg_loss": float(losses.mean()) if len(losses) else 0.0,
        "profit_factor": profit_factor,
        "expectancy": float(net.mean()),
        "sharpe": sharpe,
        "sortino": sortino,
        "max_drawdown": max_dd,
    }


def threshold_sweep(oos: pd.DataFrame, cfg: Config, margins=(0.04, 0.06, 0.08, 0.10, 0.12)) -> pd.DataFrame:
    """Diagnostic: net edge vs confidence margin around 0.5 (symmetric)."""
    rows = []
    for m in margins:
        c = Config(**{**cfg.__dict__, "long_threshold": 0.5 + m, "short_threshold": 0.5 - m})
        res = run_backtest(oos, c)
        rows.append(
            {
                "margin": m,
                "n_trades": res["n_trades"],
                "net_return": res["net_return"],
                "expectancy": res["expectancy"],
                "sharpe": res["sharpe"],
                "directional_accuracy": res["directional_accuracy"],
            }
        )
    return pd.DataFrame(rows)
