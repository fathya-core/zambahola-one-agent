# Stable live - no sudden disconnect: keep-awake + watch + guard (Windows OMAR-PC)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "phase5-keep-awake.ps1")

Write-Host "=== ZAMBAHOLA Phase 5 Stable (live, no night train kill) ===" -ForegroundColor Cyan

Write-Host ""
Write-Host "[1] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host ""
Write-Host "[2] skip night train tonight (agent will NOT be stopped for train)..." -ForegroundColor Cyan
node scripts/phase5-mark-night-done.mjs

Write-Host ""
Enable-Phase5KeepAwake

Write-Host ""
Write-Host "[3] start agent if needed..." -ForegroundColor Cyan
npm run agent:phase5-ready
Start-Sleep -Seconds 5

Write-Host ""
Write-Host "[4] stable stack (watch + guard) - DO NOT CLOSE" -ForegroundColor Cyan
Write-Host "Log: apps/one-agent/data/bridge/PHASE5-WATCH.jsonl" -ForegroundColor Gray
node scripts/phase5-stable-stack.mjs
