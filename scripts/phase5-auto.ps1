# Phase 5 - one window: day live + night omni-train (keep window open)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== ZAMBAHOLA Phase 5 Auto ===" -ForegroundColor Cyan
Write-Host "Day: phase5-ready + bridge + watcher + guard" -ForegroundColor Yellow
Write-Host "Night: omni-train + export + reload (automatic)" -ForegroundColor Yellow
Write-Host "Log: apps/one-agent/data/bridge/PHASE5-SCHEDULER.jsonl" -ForegroundColor Gray

Write-Host ""
Write-Host "[1] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host ""
Write-Host "[2] keep PC awake on AC..." -ForegroundColor Cyan
try {
    powercfg /change standby-timeout-ac 0 | Out-Null
    powercfg /change monitor-timeout-ac 120 | Out-Null
    Write-Host "Sleep disabled on AC." -ForegroundColor Green
}
catch {
    Write-Host "Disable sleep manually if needed." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[3] starting scheduler (do NOT close this window)..." -ForegroundColor Cyan
node scripts/phase5-scheduler.mjs
