# Phase 3 boot — import research + intensive hybrid agent
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

Write-Host "=== ZAMBAHOLA Phase 3 Intensive ===" -ForegroundColor Cyan

Write-Host "[1] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host "[2] stop old agent..." -ForegroundColor Cyan
npm run agent:stop

$import = "apps/one-agent/knowledge/user-reports/AGENT-IMPORT-FINAL.json"
if (Test-Path $import) {
    Write-Host "[3] research import..." -ForegroundColor Cyan
    npm run agent:research-import -- $import
} else {
    Write-Host "[3] skip research import (file missing)" -ForegroundColor Yellow
}

Write-Host "[4] start phase3-intensive..." -ForegroundColor Cyan
npm run agent:phase3-intensive

Write-Host ""
Write-Host "Dashboard: http://127.0.0.1:8787" -ForegroundColor Green
Write-Host "Watch: Intensive learn ON | Hybrid profile | Paper trades | Dir. rolling" -ForegroundColor Green
