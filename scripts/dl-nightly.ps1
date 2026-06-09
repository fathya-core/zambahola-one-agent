# Deep learning ليلي — omni-train بينما الوكيل live أو متوقف مؤقتاً
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== ZAMBAHOLA DL nightly (omni-train quick) ===" -ForegroundColor Cyan
Write-Host "يُعيد تدريب ML/MLP/GBM على بيانات mock نظيفة — لا يستبدل live agent" -ForegroundColor Yellow

git pull origin main

Write-Host ""
Write-Host "[1] omni-train quick..." -ForegroundColor Cyan
npm run agent:omni-train:quick

Write-Host ""
Write-Host "[2] export models..." -ForegroundColor Cyan
npm run agent:export-models

Write-Host ""
Write-Host "Done. أعد تشغيل الوكيل: npm run agent:phase5-reload" -ForegroundColor Green
