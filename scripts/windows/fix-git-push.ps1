# Fix stuck git + push telemetry (Windows)
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

Write-Host "=== ZAMBAHOLA git fix ===" -ForegroundColor Cyan

git rebase --abort 2>$null
git merge --abort 2>$null

git fetch origin main
git reset --hard origin/main

Write-Host "Run bridge + agent, then:" -ForegroundColor Green
Write-Host "  npm run agent:local-bridge   (window 2)"
Write-Host "  npm run agent:push-telemetry:ps1"
