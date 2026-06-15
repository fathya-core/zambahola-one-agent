# ZAMBAHOLA BETA watchdog - keeps the autonomous agent alive 24/7.
#
# It (1) prevents the PC from sleeping, and (2) restarts the dashboard if it
# ever stops responding. Keys are auto-detected from the Desktop; settings and
# auto-trade resume from data/*.json. Run it once and leave it:
#
#   .\watchdog.ps1            -> testnet (safe)
#   .\watchdog.ps1 -Live      -> REAL money (also needs ZAMBAHOLA_I_ACCEPT_REAL_TRADING=RISK)
param(
    [int]$Port = 8799,
    [switch]$Live,
    [int]$CheckSeconds = 60
)
$ErrorActionPreference = "Continue"
$Root = $PSScriptRoot
$Py = Join-Path $Root ".venv\Scripts\python.exe"
$env:PYTHONIOENCODING = "utf-8"

# --- keep the machine awake (AC + DC) ---
try { powercfg /change standby-timeout-ac 0 | Out-Null; powercfg /change standby-timeout-dc 0 | Out-Null } catch {}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ZbhSleep {
    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED -> system stays awake while this runs
[ZbhSleep]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null

function Test-Up {
    try { return (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/state" -TimeoutSec 8).StatusCode -eq 200 }
    catch { return $false }
}

function Start-Dashboard {
    $a = @("-m", "zambahola_beta.cli", "console", "--port", "$Port", "--no-browser")
    if ($Live) { $a += "--live" }
    Start-Process -FilePath $Py -ArgumentList $a -WorkingDirectory $Root -WindowStyle Minimized
}

Write-Host "ZAMBAHOLA BETA watchdog: keeping the agent alive on :$Port ($(if($Live){'LIVE'}else{'testnet'}))" -ForegroundColor Green
while ($true) {
    if (-not (Test-Up)) {
        Write-Host "$(Get-Date -Format 'HH:mm:ss')  dashboard not responding -> (re)starting" -ForegroundColor Yellow
        Start-Dashboard
        Start-Sleep -Seconds 30
    }
    [ZbhSleep]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null
    Start-Sleep -Seconds $CheckSeconds
}
