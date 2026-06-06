# رفع telemetry — بديل ويندوز إذا فشل npm script
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "[1] bridge refresh..." -ForegroundColor Cyan
try {
    Invoke-WebRequest -Uri "http://127.0.0.1:8790/telemetry" -UseBasicParsing -TimeoutSec 15 | Out-Null
} catch {
    Write-Host "Bridge offline — start: npm run agent:local-bridge" -ForegroundColor Red
    exit 1
}

Write-Host "[2] git sync..." -ForegroundColor Cyan
git fetch origin main
$dirty = git status --porcelain
if ($dirty -match "^(?!.*bridge/LOCAL-TELEMETRY)") {
    git stash push -u -m "push-ps1" 2>$null
}
git pull origin main --rebase
if ($LASTEXITCODE -ne 0) {
    git rebase --abort 2>$null
    git reset --hard origin/main
}
git stash pop 2>$null

$ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm")
git add -f apps/one-agent/data/bridge/LOCAL-TELEMETRY.json
git add -f apps/one-agent/data/bridge/REMOTE-COMMANDS.json 2>$null
git add -f apps/one-agent/data/bridge/REMOTE-COMMANDS-DONE.json 2>$null
git commit -m "telemetry: $ts"
if ($LASTEXITCODE -eq 0) {
    git push origin main
}
Write-Host "Done." -ForegroundColor Green
