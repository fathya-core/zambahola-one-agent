# يرفع لقطة الجهاز المحلي للسحابة (Cloud Agent يقرأها بعد git pull)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

$Telemetry = "apps/one-agent/data/bridge/LOCAL-TELEMETRY.json"
if (-not (Test-Path $Telemetry)) {
    Write-Host "Run local bridge first: npm run agent:local-bridge" -ForegroundColor Yellow
    exit 1
}

Write-Host "[push-telemetry] staging..." -ForegroundColor Cyan
git add $Telemetry
git add apps/one-agent/data/bridge/REMOTE-COMMANDS.json -ErrorAction SilentlyContinue

$msg = "telemetry: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git commit -m $msg 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Nothing new to push (already committed)" -ForegroundColor Yellow
} else {
    git push origin main
    Write-Host "[push-telemetry] pushed — cloud agent can git pull" -ForegroundColor Green
}
