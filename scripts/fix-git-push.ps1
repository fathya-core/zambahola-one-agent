# إصلاح push-telemetry عندما يفشل pull/push — شغّل مرة واحدة
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== ZAMBAHOLA git fix ===" -ForegroundColor Cyan

$telemetry = "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json"
$backup = Join-Path $env:TEMP "zambahola-telemetry-backup.json"
if (Test-Path $telemetry) {
    Copy-Item $telemetry $backup -Force
    Write-Host "Backed up telemetry" -ForegroundColor Green
}

Write-Host "[1] fetch + stash all local changes..." -ForegroundColor Cyan
git fetch origin main
git stash push -u -m "zambahola-fix-$(Get-Date -Format 'yyyyMMdd-HHmm')"

Write-Host "[2] pull latest (with new push-telemetry script)..." -ForegroundColor Cyan
git pull origin main --rebase

Write-Host "[3] restore stash..." -ForegroundColor Cyan
git stash pop
if ($LASTEXITCODE -ne 0) {
    Write-Host "Stash conflict — restoring telemetry backup" -ForegroundColor Yellow
    if (Test-Path $backup) { Copy-Item $backup $telemetry -Force }
}

if (Test-Path $backup) {
    Copy-Item $backup $telemetry -Force
}

Write-Host "[4] push telemetry..." -ForegroundColor Cyan
npm run agent:push-telemetry

Write-Host "Done." -ForegroundColor Green
