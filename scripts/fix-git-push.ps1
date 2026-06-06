# إصلاح git عالق (rebase conflict / push rejected) — شغّل من جذر المشروع
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== ZAMBAHOLA git reset + push telemetry ===" -ForegroundColor Cyan

$telemetry = "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json"

Write-Host "[1] abort rebase/merge if stuck..." -ForegroundColor Cyan
git rebase --abort 2>$null
git merge --abort 2>$null

Write-Host "[2] fetch + align with origin/main..." -ForegroundColor Cyan
git fetch origin main
if ($LASTEXITCODE -ne 0) { exit 1 }
git reset --hard origin/main
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "[3] refresh telemetry from bridge..." -ForegroundColor Cyan
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:8790/telemetry" -UseBasicParsing -TimeoutSec 15 | Out-Null
    Write-Host "  bridge OK" -ForegroundColor Green
} catch {
    Write-Host "  bridge offline — using existing file if any" -ForegroundColor Yellow
}

Write-Host "[4] push telemetry..." -ForegroundColor Cyan
npm run agent:push-telemetry
$code = $LASTEXITCODE

Write-Host ""
if ($code -eq 0) {
    Write-Host "SUCCESS — telemetry on GitHub" -ForegroundColor Green
    Write-Host "Optional: git stash list  (your wip stash is still saved)" -ForegroundColor Cyan
    Write-Host "  git stash pop   — restore local edits if needed" -ForegroundColor Cyan
} else {
    Write-Host "FAILED — paste full output to cloud agent" -ForegroundColor Red
}
exit $code
