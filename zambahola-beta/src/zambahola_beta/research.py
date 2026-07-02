"""Curated research: projects and blogs closest to ZAMBAHOLA's thesis.

Static catalog — updated by agents after literature/repo scans. Exposed on the
dashboard so the user never hunts manually.
"""
from __future__ import annotations

# Each entry: name, url, similarity (1-5), what they do, what ZAMBAHOLA can borrow, risk note.
CATALOG: list[dict] = [
    {
        "name": "HKUDS/AI-Trader",
        "url": "https://github.com/HKUDS/AI-Trader",
        "type": "platform",
        "similarity": 2,
        "thesis": "Agent-native signal platform — publish/copy/discuss trades (NOT a quant engine).",
        "borrow": "External leaderboard comparison, challenge tracking, heartbeat alerts.",
        "risk": "Hosted platform = third-party data; self-host needs FastAPI+SQLite stack.",
        "blog": None,
    },
    {
        "name": "darkvolg/TrendRider (Freqtrade)",
        "url": "https://github.com/darkvolg/trading",
        "type": "strategy",
        "similarity": 5,
        "thesis": "Multi-indicator confluence + hyperopt + walk-forward; public live paper stats.",
        "borrow": "Verifiable live dashboard, documented failures, regime-aware entry thresholds.",
        "risk": "Perp futures not spot; hyperopt overfit if WFE not checked.",
        "blog": "https://trendrider.net/live",
    },
    {
        "name": "moo-22/opencrypto",
        "url": "https://github.com/moo-22/opencrypto",
        "type": "framework",
        "similarity": 4,
        "thesis": "Modular spot/futures pipeline: 29 indicators, manipulation shield, progressive trailing SL.",
        "borrow": "Progressive trailing (breakeven at 30% progress), BTC crash gate, slippage model.",
        "risk": "Claims 85% win rate — likely in-sample; validate independently.",
        "blog": None,
    },
    {
        "name": "nazmiefearmutcu/Dive Into Crypto",
        "url": "https://github.com/nazmiefearmutcu/TRADING-BOT",
        "type": "scanner",
        "similarity": 4,
        "thesis": "15 indicators × 12 timeframes → single consensus; whale positioning filter.",
        "borrow": "Multi-TF consensus voting, breadth/divergence filter before ranking.",
        "risk": "Futures-only scanner; whale data can lag.",
        "blog": None,
    },
    {
        "name": "iyeque/traider",
        "url": "https://github.com/iyeque/traider",
        "type": "bot",
        "similarity": 4,
        "thesis": "Hybrid breakout/grid + sentiment gate (Fear&Greed, news) + walk-forward Optuna.",
        "borrow": "Sentiment safety gate, global drawdown halt, realistic backtest constraints.",
        "risk": "Sentiment APIs rate-limited; grid mode differs from trend rotation.",
        "blog": None,
    },
    {
        "name": "yakub268/algo-trading-platform",
        "url": "https://github.com/yakub268/algo-trading-platform",
        "type": "orchestrator",
        "similarity": 3,
        "thesis": "50+ bots, HMM regime, 8-source ensemble, Thompson sampling fleet controller.",
        "borrow": "Regime detection (HMM), ensemble veto layer, fleet-level risk caps.",
        "risk": "Complexity; hard to reproduce without their infra.",
        "blog": None,
    },
    {
        "name": "pro-tech-killers/binance-trading-bot",
        "url": "https://github.com/pro-tech-killers/binance-trading-bot",
        "type": "bot",
        "similarity": 3,
        "thesis": "SuperTrend/EMA-RSI on Binance spot; closed-candle signals; testnet default.",
        "borrow": "Strict closed-bar execution, poll loop simplicity, dry-run first.",
        "risk": "Single-pair; no portfolio rotation.",
        "blog": None,
    },
]

BLOGS: list[dict] = [
    {
        "title": "Survivorship Bias in Crypto Backtesting",
        "url": "https://vantixs.com/blog/survivorship-bias-crypto-tokens-backtesting",
        "lesson": "Point-in-time universes + walk-forward expose inflated backtests (15-40% return inflation).",
        "zambahola_status": "partial — WFE added; full PIT universe still missing.",
    },
    {
        "title": "How to Eliminate Survivorship Bias (CoinAPI)",
        "url": "https://www.coinapi.io/blog/how-to-eliminate-survivorship-bias-in-crypto-backtesting",
        "lesson": "Include delisted symbols; rebuild tradable set at each rebalance timestamp.",
        "zambahola_status": "warning shown in backtest UI; data not yet delist-aware.",
    },
    {
        "title": "Crypto Strategy Robustness Checklist (Keel)",
        "url": "https://usekeel.io/learn/crypto-strategy-robustness",
        "lesson": "OOS Sharpe ≥70% of IS; Monte Carlo; funding/slippage; live-parity checks.",
        "zambahola_status": "WFE + fees in backtest; funding N/A on spot; live-parity in progress.",
    },
    {
        "title": "Algorithmic Trading on Hyperliquid (Robot Traders)",
        "url": "https://robottraders.io/blog/algorithmic-trading-hyperliquid-dex-python",
        "lesson": "CCXT unified API; next-bar-open execution; backtest before live.",
        "zambahola_status": "aligned — closed candles, testnet-first.",
    },
]


def research_digest() -> dict:
    """Return sorted catalog + actionable gaps for ZAMBAHOLA."""
    ranked = sorted(CATALOG, key=lambda x: -x["similarity"])
    gaps = []
    for b in BLOGS:
        if "missing" in b.get("zambahola_status", "") or "partial" in b.get("zambahola_status", ""):
            gaps.append({"source": b["title"], "gap": b["lesson"], "status": b["zambahola_status"]})
    return {
        "projects": ranked,
        "blogs": BLOGS,
        "top_similar": [p["name"] for p in ranked if p["similarity"] >= 4][:5],
        "gaps_to_close": gaps,
        "ai_trader_note": (
            "AI-Trader is a SIGNAL PLATFORM (social/copy), not a strategy engine. "
            "Use standalone for community comparison; do NOT wire API keys into Zambahola."
        ),
    }
