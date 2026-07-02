# ZAMBAHOLA — hands-off launcher for the trading console.
# Starts the dashboard/agent minimized IF it isn't already running.
# Registered to run automatically at Windows logon (see install-autostart.ps1),
# so you never type a command. Auto-trading is controlled inside the dashboard.

$ErrorActionPreference = "SilentlyContinue"
$Port = 8799
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Py   = Join-Path $Root ".venv\Scripts\python.exe"

# already up? (dashboard answers on the port) -> do nothing, avoid duplicates
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/state" -TimeoutSec 4 -UseBasicParsing
    if ($r.StatusCode -eq 200) { Write-Host "ZAMBAHOLA already running on $Port"; exit 0 }
} catch { }

# keys live outside the repo (Desktop); the app also auto-detects them
$env:PYTHONIOENCODING          = "utf-8"
$env:ZAMBAHOLA_KEYS_FILE         = "C:\Users\pc\OneDrive\Desktop\binance-API.txt"
$env:ZAMBAHOLA_TESTNET_KEYS_FILE = "C:\Users\pc\OneDrive\Desktop\testnet-keys.txt"

if (-not (Test-Path $Py)) { $Py = "python" }  # fallback to PATH python

Start-Process -WindowStyle Minimized -WorkingDirectory $Root -FilePath $Py `
    -ArgumentList "-m","zambahola_beta.cli","console","--port","$Port","--no-browser"

Write-Host "ZAMBAHOLA started (minimized) on http://127.0.0.1:$Port"
