"""ZAMBAHOLA BETA — offline, validated ML pipeline for BTC direction.

Pipeline: data -> features -> labels -> model (purged walk-forward) ->
cost-aware backtest. The goal is a *validated edge after costs*, not raw
accuracy. See README.md.
"""

from .config import Config

__all__ = ["Config"]
__version__ = "0.1.0"
