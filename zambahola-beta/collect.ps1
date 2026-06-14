# Long-running L2 microstructure collector for ZAMBAHOLA BETA.
# Runs the resilient recorder indefinitely and auto-restarts it if the process
# ever exits (the recorder already auto-reconnects on dropped sockets; this is a
# belt-and-suspenders wrapper for multi-day capture). Stop with Ctrl+C.
#
# Usage:  .\collect.ps1            (default BTCUSDT, 1s bars)
#         .\collect.ps1 ETHUSDT    (different symbol -> wider spread, maybe edge)
param(
    [string]$Symbol = "BTCUSDT",
    [int]$BarMs = 1000
)
$ErrorActionPreference = "Continue"
$Root = $PSScriptRoot
$Py = Join-Path $Root ".venv\Scripts\python.exe"

Write-Host "=== ZAMBAHOLA BETA collector ($Symbol, ${BarMs}ms bars) ===" -ForegroundColor Cyan
Write-Host "Recording to $Root\data\micro  ·  Ctrl+C to stop" -ForegroundColor Gray

while ($true) {
    try {
        & $Py -m zambahola_beta.cli record --symbol $Symbol --seconds 0 --bar-ms $BarMs
    }
    catch {
        Write-Host "[collect] recorder exited: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    Write-Host "[collect] restarting recorder in 5s..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}
