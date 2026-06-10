# Phase 5 - one command before sleep (Windows OMAR-PC)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "phase5-keep-awake.ps1")

Write-Host "=== ZAMBAHOLA Phase 5 Sleep ===" -ForegroundColor Cyan
Write-Host "Reset night state + strong train + verify + paper trade" -ForegroundColor Yellow

Write-Host ""
Write-Host "[1] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host ""
Write-Host "[2] reset tonight night state..." -ForegroundColor Cyan
node scripts/phase5-reset-night.mjs

Write-Host ""
Enable-Phase5KeepAwake

Write-Host ""
Write-Host "[3] preflight..." -ForegroundColor Cyan
node scripts/phase5-preflight.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "Preflight failed. Fix errors above before sleep." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "[4] starting phase5-auto - DO NOT CLOSE this window" -ForegroundColor Cyan
Write-Host "Log: apps/one-agent/data/bridge/PHASE5-SCHEDULER.jsonl" -ForegroundColor Gray
Write-Host "If PC sleeps anyway, after wake run: npm run agent:phase5-wake-resume" -ForegroundColor Gray
npm run agent:phase5-auto:node
