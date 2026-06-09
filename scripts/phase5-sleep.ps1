# Phase 5 - one command before sleep (Windows OMAR-PC)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== ZAMBAHOLA Phase 5 Sleep ===" -ForegroundColor Cyan
Write-Host "Reset night state + strong train + verify + paper trade" -ForegroundColor Yellow

Write-Host ""
Write-Host "[1] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host ""
Write-Host "[2] reset tonight night state..." -ForegroundColor Cyan
node scripts/phase5-reset-night.mjs

Write-Host ""
Write-Host "[3] keep PC awake on AC..." -ForegroundColor Cyan
try {
    powercfg /change standby-timeout-ac 0 | Out-Null
    powercfg /change monitor-timeout-ac 120 | Out-Null
    Write-Host "Sleep disabled on AC." -ForegroundColor Green
}
catch {
    Write-Host "Disable sleep manually if needed." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[4] preflight..." -ForegroundColor Cyan
node scripts/phase5-preflight.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "Preflight failed. Fix errors above before sleep." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "[5] starting phase5-auto - DO NOT CLOSE this window" -ForegroundColor Cyan
Write-Host "Log: apps/one-agent/data/bridge/PHASE5-SCHEDULER.jsonl" -ForegroundColor Gray
npm run agent:phase5-auto:node
