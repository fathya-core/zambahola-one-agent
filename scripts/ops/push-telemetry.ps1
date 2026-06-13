# Push telemetry - Windows (bridge OR agent :8787 fallback)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

Write-Host "[1] collect telemetry..." -ForegroundColor Cyan
node scripts/ops/collect-telemetry.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed collect - start agent: npm run agent:phase4-hit-recover" -ForegroundColor Red
    Write-Host "Or start bridge: npm run agent:local-bridge" -ForegroundColor Yellow
    exit 1
}

Write-Host "[2] git push..." -ForegroundColor Cyan
git fetch origin main
git add -f apps/one-agent/data/bridge/LOCAL-TELEMETRY.json
if (Test-Path apps/one-agent/data/bridge/REMOTE-COMMANDS.json) {
    git add -f apps/one-agent/data/bridge/REMOTE-COMMANDS.json
}
if (Test-Path apps/one-agent/data/bridge/REMOTE-COMMANDS-DONE.json) {
    git add -f apps/one-agent/data/bridge/REMOTE-COMMANDS-DONE.json
}

$ts = (Get-Date).ToString("yyyy-MM-dd HH:mm")
git commit -m "telemetry: $ts"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Nothing new to commit" -ForegroundColor Yellow
    exit 0
}

git pull origin main --rebase --autostash
git push origin main
Write-Host "SUCCESS" -ForegroundColor Green
