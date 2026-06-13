# Phase 5 - one window: day live + night omni-train (keep window open)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root
. (Join-Path $PSScriptRoot "phase5-keep-awake.ps1")

Write-Host "=== ZAMBAHOLA Phase 5 Auto ===" -ForegroundColor Cyan
Write-Host "Day: phase5-ready + bridge + watcher + guard" -ForegroundColor Yellow
Write-Host "Night: omni-train + export + reload (automatic)" -ForegroundColor Yellow
Write-Host "Log: apps/one-agent/data/bridge/PHASE5-SCHEDULER.jsonl" -ForegroundColor Gray

Write-Host ""
Write-Host "[1] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host ""
Enable-Phase5KeepAwake

Write-Host ""
Write-Host "[2] starting scheduler (do NOT close this window)..." -ForegroundColor Cyan
node scripts/phase5/phase5-scheduler.mjs
