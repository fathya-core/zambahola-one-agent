# Resume after PC slept/rebooted (Windows OMAR-PC) - restarts strong night train
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "phase5-keep-awake.ps1")

Write-Host "=== ZAMBAHOLA Phase 5 Wake Resume ===" -ForegroundColor Cyan
Write-Host "PC woke up - restarting night train if still night hours" -ForegroundColor Yellow

Write-Host ""
Write-Host "[1] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host ""
Write-Host "[2] clear stale night state..." -ForegroundColor Cyan
node scripts/phase5-reset-night.mjs

Write-Host ""
Enable-Phase5KeepAwake

Write-Host ""
Write-Host "[3] preflight..." -ForegroundColor Cyan
node scripts/phase5-preflight.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "Preflight failed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "[4] restart phase5-auto - DO NOT CLOSE" -ForegroundColor Cyan
npm run agent:phase5-auto:node
