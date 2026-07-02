"""Tests for local benchmark + research catalog."""
from zambahola_beta.benchmark import compute_benchmark
from zambahola_beta.research import research_digest


def test_research_digest_has_similar_projects():
    d = research_digest()
    assert len(d["projects"]) >= 5
    assert any(p["similarity"] >= 4 for p in d["projects"])
    assert "ai_trader_note" in d


def test_benchmark_empty_history():
    import os
    from pathlib import Path
    old = os.environ.get("ZAMBAHOLA_DATA_DIR")
    os.environ["ZAMBAHOLA_DATA_DIR"] = str(Path(__file__).resolve().parent / "_empty_data")
    try:
        p = Path(os.environ["ZAMBAHOLA_DATA_DIR"])
        p.mkdir(exist_ok=True)
        (p / "equity_history.json").write_text("[]", encoding="utf-8")
        r = compute_benchmark()
        assert r["ok"] is False
    finally:
        if old is None:
            os.environ.pop("ZAMBAHOLA_DATA_DIR", None)
        else:
            os.environ["ZAMBAHOLA_DATA_DIR"] = old
