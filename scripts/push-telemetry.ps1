# Push telemetry - Windows fallback
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "[1] bridge refresh..." -ForegroundColor Cyan
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:8790/telemetry" -UseBasicParsing -TimeoutSec 15 | Out-Null
    Write-Host "  bridge OK" -ForegroundColor Green
} catch {
    Write-Host "Bridge offline - run: npm run agent:local-bridge" -ForegroundColor Red
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

$ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm")
git commit -m "telemetry: $ts"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Nothing new to commit" -ForegroundColor Yellow
    exit 0
}

git pull origin main --rebase --autostash
git push origin main
Write-Host "SUCCESS" -ForegroundColor Green
