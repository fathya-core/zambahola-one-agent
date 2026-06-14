# ZAMBAHOLA BETA — one-click launcher.
# Double-click (or run) this to open the dashboard. No commands needed.
#
# Optional: point at your keys file BEFORE running to see your account/execute:
#   $env:ZAMBAHOLA_KEYS_FILE = "C:\Users\pc\OneDrive\Desktop\testnet-keys.txt"
#
# Profiles:
#   .\start.ps1                 -> testnet dashboard (safe, default)
#   .\start.ps1 -Live           -> REAL money mode (also needs the RISK env confirm)
param(
    [switch]$Live,
    [string]$Assets = "BTCUSDT,ETHUSDT",
    [int]$Port = 8799
)
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Py = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $Py)) {
    Write-Host "First-time setup (creating venv + installing deps)..." -ForegroundColor Cyan
    python -m venv (Join-Path $Root ".venv")
    & $Py -m pip install -q -e (Join-Path $Root ".")
}

$liveArg = if ($Live) { "--live" } else { "" }
Write-Host "Opening ZAMBAHOLA BETA console at http://127.0.0.1:$Port ..." -ForegroundColor Green
& $Py -m zambahola_beta.cli console --assets $Assets --port $Port $liveArg
