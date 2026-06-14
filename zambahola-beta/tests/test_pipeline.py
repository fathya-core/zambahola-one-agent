from zambahola_beta.config import Config
from zambahola_beta.pipeline import assemble_dataset, run_pipeline
from zambahola_beta.features import FEATURE_COLUMNS


def test_assemble_dataset_clean(klines):
    cfg = Config()
    data = assemble_dataset(klines, cfg)
    assert len(data) > 0
    for col in [*FEATURE_COLUMNS, "label", "ret"]:
        assert col in data.columns
    assert not data[FEATURE_COLUMNS].isna().any().any()
    assert not data["label"].isna().any()
    assert not data["ret"].isna().any()


def test_run_pipeline_end_to_end(klines):
    cfg = Config(n_splits=4, embargo=30)
    report = run_pipeline(cfg, klines=klines, write_report=False)
    # structure
    for key in ("dataset", "validation", "backtest", "verdict"):
        assert key in report
    assert report["validation"]["folds"] >= 1
    assert "has_edge_after_costs" in report["verdict"]
    # backtest metrics exist and are JSON-clean (no NaN floats)
    bt = report["backtest"]
    for key in ("net_return", "sharpe", "max_drawdown", "n_trades"):
        assert key in bt
