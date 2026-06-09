# Phase 5 — أمر واحد: نهار live + ليل omni-train (اترك النافذة مفتوحة)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== ZAMBAHOLA Phase 5 Auto ===" -ForegroundColor Cyan
Write-Host "نهار: phase5-ready + live-stack" -ForegroundColor Yellow
Write-Host "ليل: omni-train + export + reload (تلقائي)" -ForegroundColor Yellow
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
