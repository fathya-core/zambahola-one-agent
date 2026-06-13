# إعادة تشغيل صحيحة — يوقف القديم ويشغّل بإعدادات directional
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

Write-Host "[1/4] git pull..." -ForegroundColor Cyan
git pull origin main

Write-Host "[2/4] stop old agent..." -ForegroundColor Cyan
npm run agent:stop

Write-Host "[3/4] import research weights..." -ForegroundColor Cyan
npm run agent:research-import -- apps/one-agent/knowledge/user-reports/AGENT-IMPORT-FINAL.json

Write-Host "[4/4] start phase2-live (micro gates + meta-PnL + analyst)..." -ForegroundColor Cyan
npm run agent:phase2-live

Write-Host ""
Write-Host "Check: Horizon 45s | LABEL_BP 2.5 | Meta 0.55 | Analyst AR on dashboard" -ForegroundColor Green
Write-Host "http://127.0.0.1:8787"
