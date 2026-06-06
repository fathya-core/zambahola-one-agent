# إعادة تشغيل صحيحة — يوقف القديم ويشغّل بإعدادات directional
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "[1/4] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host "[2/4] stop old agent..." -ForegroundColor Cyan
npm run agent:stop

Write-Host "[3/4] import research weights..." -ForegroundColor Cyan
npm run agent:research-import -- apps/one-agent/knowledge/user-reports/AGENT-IMPORT-FINAL.json

Write-Host "[4/4] start directional-live..." -ForegroundColor Cyan
npm run agent:directional-live

Write-Host ""
Write-Host "Check dashboard: Horizon must be 45s, Abstain under 90%" -ForegroundColor Green
Write-Host "http://127.0.0.1:8787"
