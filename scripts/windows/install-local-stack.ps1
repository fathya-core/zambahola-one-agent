# تثبيت الربط المحلي كامل — مرة واحدة على ويندوز
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

Write-Host "=== ZAMBAHOLA Local Stack ===" -ForegroundColor Cyan

if (-not (Test-Path "config/bridge.env")) {
    Copy-Item "config/bridge.env.example" "config/bridge.env"
    Write-Host "Created config/bridge.env — edit ZAMBAHOLA_BRIDGE_TOKEN" -ForegroundColor Yellow
}

Write-Host "[0] git merge driver for telemetry..." -ForegroundColor Cyan
git config merge.ours.driver true
git config merge.ours.name "keep local telemetry on conflict"

Write-Host "[1] npm setup..." -ForegroundColor Cyan
npm run setup

Write-Host "[2] copy Cursor MCP config..." -ForegroundColor Cyan
$cursorDir = Join-Path $Root ".cursor"
New-Item -ItemType Directory -Force -Path $cursorDir | Out-Null
if (-not (Test-Path (Join-Path $cursorDir "mcp.json"))) {
    Copy-Item (Join-Path $cursorDir "mcp.json.example") (Join-Path $cursorDir "mcp.json")
    Write-Host "Created .cursor/mcp.json" -ForegroundColor Green
}

Write-Host ""
Write-Host "Recommended (ONE window — day + night automatic):" -ForegroundColor Green
Write-Host "  npm run agent:phase5-auto"
Write-Host ""
Write-Host "Or manual (2 terminals):" -ForegroundColor Yellow
Write-Host "  1) npm run agent:phase5-ready   (or phase4-hit-recover)"
Write-Host "  2) npm run agent:live-stack   (bridge + watcher + guard)"
Write-Host ""
Write-Host "Boot at login (Windows):" -ForegroundColor Cyan
Write-Host "  npm run agent:phase5-install-task"
Write-Host ""
Write-Host "Or separate:" -ForegroundColor Yellow
Write-Host "  npm run agent:local-bridge | agent:remote-watcher | agent:guard | agent:push-telemetry:ps1"
Write-Host ""
Write-Host "Health: npm run agent:health-check" -ForegroundColor Cyan
Write-Host "Cursor plugins: .\scripts\windows\install-cursor-marketplace.ps1" -ForegroundColor Cyan
Write-Host "Optional tunnel: npm run agent:tunnel-bridge" -ForegroundColor Cyan
Write-Host "Docs: docs/ar/ربط-الجهاز-المحلي.md · docs/ar/تثبيت-اضافات-السوق.md"
