# ZAMBAHOLA BETA — LIVE launcher (REAL money, one double-click).
#
# Sets the explicit risk consent for THIS process tree only, then runs the
# 24/7 watchdog in -Live mode (which starts the dashboard with --live).
# Budget caps come from data/config.json (max_order_usd / max_total_usd).
#
#   .\live.ps1            -> REAL trading on :8799 (keys: Desktop binance-API.txt)
#
# To go back to safe testnet: close this window/process and run .\watchdog.ps1
$ErrorActionPreference = "Continue"
$env:ZAMBAHOLA_I_ACCEPT_REAL_TRADING = "RISK"
& (Join-Path $PSScriptRoot "watchdog.ps1") -Live
