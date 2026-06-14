# ZAMBAHOLA BETA - one-click launcher.
# Double-click (or run) this to open the dashboard. No commands needed.
#
# It auto-detects your key files on the Desktop so the account connects:
#   - live keys   : Desktop\binance-API.txt   -> ZAMBAHOLA_KEYS_FILE
#   - testnet keys: Desktop\testnet-keys.txt   -> ZAMBAHOLA_TESTNET_KEYS_FILE
# (Override by setting those env vars yourself before running.)
#
# Profiles:
#   .\start.ps1            -> testnet dashboard (safe, default; uses testnet keys)
#   .\start.ps1 -Live      -> REAL money mode (also needs ZAMBAHOLA_I_ACCEPT_REAL_TRADING=RISK)
param(
    [switch]$Live,
    [int]$Port = 8799
)
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Py = Join-Path $Root ".venv\Scripts\python.exe"

# Windows console is cp1256 here; force UTF-8 so prints never crash.
$env:PYTHONIOENCODING = "utf-8"

# Auto-locate key files on the Desktop (OneDrive or local) if not already set.
$desktops = @(
    (Join-Path $env:USERPROFILE "OneDrive\Desktop"),
    (Join-Path $env:USERPROFILE "Desktop")
) | Where-Object { Test-Path $_ }

function Find-Key([string]$name) {
    foreach ($d in $desktops) {
        $p = Join-Path $d $name
        if (Test-Path $p) { return $p }
    }
    return $null
}

if (-not $env:ZAMBAHOLA_KEYS_FILE) {
    $live = Find-Key "binance-API.txt"
    if ($live) { $env:ZAMBAHOLA_KEYS_FILE = $live; Write-Host "live keys:    $live" -ForegroundColor DarkGray }
}
if (-not $env:ZAMBAHOLA_TESTNET_KEYS_FILE) {
    $tn = Find-Key "testnet-keys.txt"
    if ($tn) { $env:ZAMBAHOLA_TESTNET_KEYS_FILE = $tn; Write-Host "testnet keys: $tn" -ForegroundColor DarkGray }
}

if (-not (Test-Path $Py)) {
    Write-Host "First-time setup (creating venv + installing deps)..." -ForegroundColor Cyan
    python -m venv (Join-Path $Root ".venv")
    & $Py -m pip install -q -e (Join-Path $Root ".")
}

$liveArg = if ($Live) { "--live" } else { "" }
$mode = if ($Live) { "REAL (live)" } else { "testnet (safe)" }
Write-Host "Opening ZAMBAHOLA BETA console [$mode] at http://127.0.0.1:$Port ..." -ForegroundColor Green
& $Py -m zambahola_beta.cli console --port $Port $liveArg
