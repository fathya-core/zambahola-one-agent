from zambahola_beta.config import Config
from zambahola_beta.search import LEADERBOARD_COLUMNS, rank_leaderboard, run_search

from conftest import make_trend_klines


def test_run_search_offline_produces_leaderboard():
    klines = {
        "5m": make_trend_klines(n=2500, seed=1),
        "15m": make_trend_klines(n=2500, seed=2),
    }
    base = Config(bars=2500, n_splits=3, embargo=20)
    lb = run_search(
        base,
        intervals=["5m", "15m"],
        horizons=[4, 8],
        barrier_mults=[1.0, 2.0],
        margins=[0.06, 0.10],
        fetch=False,
        klines_by_interval=klines,
    )
    assert not lb.empty
    assert list(lb.columns) == LEADERBOARD_COLUMNS
    # grid size = 2 intervals * 2 horizons * 2 mults * 2 margins = 16 (minus skipped)
    assert len(lb) <= 16
    assert lb["interval"].isin(["5m", "15m"]).all()


def test_rank_leaderboard_orders_by_net_return():
    klines = {"15m": make_trend_klines(n=2500, seed=4)}
    base = Config(bars=2500, n_splits=3, embargo=20)
    lb = run_search(
        base,
        intervals=["15m"],
        horizons=[4, 8],
        barrier_mults=[1.0, 2.0],
        margins=[0.08],
        fetch=False,
        klines_by_interval=klines,
    )
    ranked = rank_leaderboard(lb, min_trades=1)
    if len(ranked) >= 2:
        assert ranked["net_return"].iloc[0] >= ranked["net_return"].iloc[1]
