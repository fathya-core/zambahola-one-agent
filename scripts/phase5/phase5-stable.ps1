# Stable live - no sudden disconnect: keep-awake + watch + guard (Windows OMAR-PC)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root
. (Join-Path $PSScriptRoot "phase5-keep-awake.ps1")

Write-Host "=== ZAMBAHOLA Phase 5 Stable (live, no night train kill) ===" -ForegroundColor Cyan

Write-Host ""
Write-Host "[1] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host ""
Write-Host "[2] purge remote reload/stop commands (main disconnect cause)..." -ForegroundColor Cyan
node scripts/phase5/phase5-sanitize-remote.mjs

Write-Host ""
Write-Host "[3] skip night train tonight..." -ForegroundColor Cyan
node scripts/phase5/phase5-mark-night-done.mjs

Write-Host ""
Enable-Phase5KeepAwake

Write-Host ""
Write-Host "[4] start agent if needed..." -ForegroundColor Cyan
npm run agent:phase5-ready
Start-Sleep -Seconds 5

Write-Host ""
Write-Host "[5] stable stack (watch + guard) - DO NOT CLOSE" -ForegroundColor Cyan
Write-Host "Log: apps/one-agent/data/bridge/PHASE5-WATCH.jsonl" -ForegroundColor Gray
node scripts/phase5/phase5-stable-stack.mjs
