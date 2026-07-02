# Install HKUDS/AI-Trader as a STANDALONE sandbox - NOT wired to Zambahola.
# Runs on port 8800 in a sibling folder.
#   powershell -ExecutionPolicy Bypass -File .\install-ai-trader-standalone.ps1

$ErrorActionPreference = "Stop"
$Target = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) "AI-Trader-standalone"
$Port   = 8800

Write-Host "=== AI-Trader standalone (separate from Zambahola) ==="
Write-Host "Target: $Target"

if (-not (Test-Path $Target)) {
    Write-Host "Cloning HKUDS/AI-Trader..."
    git clone --depth 1 https://github.com/HKUDS/AI-Trader.git $Target
}
else {
    Write-Host "Already cloned - pulling latest..."
    Push-Location $Target
    git pull --ff-only 2>$null
    Pop-Location
}

$envFile = Join-Path $Target ".env"
$envExample = Join-Path $Target ".env.example"
if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
    Copy-Item $envExample $envFile
    Write-Host "Created .env from .env.example (SQLite local mode)"
}

$venv = Join-Path $Target ".venv"
$py   = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Creating Python venv..."
    python -m venv $venv
    & $py -m pip install -q -U pip
    & $py -m pip install -q -r (Join-Path $Target "service\requirements.txt")
}

try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/docs" -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200) {
        Write-Host "AI-Trader backend already running on $Port"
        exit 0
    }
}
catch { }

$serverDir = Join-Path $Target "service\server"
Write-Host "Starting AI-Trader backend on http://127.0.0.1:$Port ..."
Start-Process -WindowStyle Minimized -WorkingDirectory $serverDir -FilePath $py `
    -ArgumentList "-m","uvicorn","main:app","--host","127.0.0.1","--port","$Port"

Write-Host ""
Write-Host "Done. AI-Trader is SEPARATE from Zambahola:"
Write-Host "  Zambahola dashboard : http://127.0.0.1:8799"
Write-Host "  AI-Trader API docs  : http://127.0.0.1:$Port/docs"
Write-Host "We do NOT auto-connect Zambahola to AI-Trader."
