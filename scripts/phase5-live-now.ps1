# Trade NOW - skip long night train, start live agent (Windows OMAR-PC)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. (Join-Path $PSScriptRoot "phase5-keep-awake.ps1")

Write-Host "=== ZAMBAHOLA Live NOW (no wait until morning) ===" -ForegroundColor Cyan

Write-Host ""
Write-Host "[1] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host ""
Write-Host "[2] skip tonight long night train..." -ForegroundColor Cyan
node scripts/phase5-mark-night-done.mjs

Write-Host ""
Enable-Phase5KeepAwake

Write-Host ""
Write-Host "[3] start live agent..." -ForegroundColor Cyan
npm run agent:phase5-ready

Write-Host ""
Write-Host "[4] verify..." -ForegroundColor Cyan
Start-Sleep -Seconds 6
node scripts/phase5-night-verify.mjs --live-only
if ($LASTEXITCODE -ne 0) {
    Write-Host "Verify failed - try: npm run agent:phase5-ready" -ForegroundColor Yellow
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Live NOW - paper trading on http://127.0.0.1:8787" -ForegroundColor Green
Write-Host "To avoid sudden disconnect run: npm run agent:phase5-stable" -ForegroundColor Yellow
