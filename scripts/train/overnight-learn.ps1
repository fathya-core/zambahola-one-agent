# ZAMBAHOLA overnight - learn-trade + watchdog + auto telemetry (8h default)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

if ($env:ZAMBAHOLA_OVERNIGHT_HOURS) {
    $Hours = $env:ZAMBAHOLA_OVERNIGHT_HOURS
} else {
    $Hours = "8"
}

Write-Host "=== ZAMBAHOLA overnight ($Hours h) ===" -ForegroundColor Cyan
Write-Host "Mode: phase2-hybrid (auto learn/signals) + watchdog + auto push" -ForegroundColor Yellow

Write-Host ""
Write-Host "[1] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host ""
Write-Host "[2] keep PC awake (plugged in)..." -ForegroundColor Cyan
try {
    powercfg /change standby-timeout-ac 0 | Out-Null
    powercfg /change monitor-timeout-ac 120 | Out-Null
    Write-Host "Sleep disabled on AC. Plug laptop into power." -ForegroundColor Green
}
catch {
    Write-Host "Could not change power settings - disable sleep manually in Windows." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[3] starting watchdog (minimize this window, do NOT close)..." -ForegroundColor Cyan
Write-Host 'Log: apps/one-agent/data/bridge/OVERNIGHT-LOG.jsonl' -ForegroundColor Gray
Write-Host 'Dashboard: http://127.0.0.1:8787' -ForegroundColor Gray

$env:ZAMBAHOLA_OVERNIGHT_HOURS = $Hours
$env:ZAMBAHOLA_OVERNIGHT_START = "agent:phase2-hybrid"
node scripts/train/overnight-watchdog.mjs
