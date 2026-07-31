# ZAMBAHOLA BETA watchdog - keeps the autonomous agent alive 24/7.
#
# It (1) prevents the PC from sleeping, and (2) restarts the dashboard if it
# ever stops responding. Keys are auto-detected from the Desktop; settings and
# auto-trade resume from data/*.json. Run it once and leave it:
#
#   .\watchdog.ps1            -> testnet (safe)
#   .\watchdog.ps1 -Live      -> REAL money mode (safe)
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

# AUTHORITATIVE liveness = is the TCP port LISTENING. During a heavy scan/backtest the
# Python GIL is saturated and the HTTP /api/state probe can time out for >8s even though
# the process is perfectly alive and still owns the port. The old HTTP-only check treated
# that as "dead" and launched a DUPLICATE python every minute (the pile-up the user saw).
# A listening port proves the one true instance is alive -> we must NEVER spawn another.
function Test-PortListening {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect("127.0.0.1", $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(2000, $false)
        if ($ok -and $c.Connected) { $c.EndConnect($iar); $c.Close(); return $true }
        $c.Close(); return $false
    } catch { return $false }
}

function Start-Dashboard {
    # belt-and-suspenders: never launch if the port is already held (single-instance).
    if (Test-PortListening) { Write-Host "  port :$Port already listening -> skip start" -ForegroundColor DarkGray; return }
    $a = @("-m", "zambahola_beta.cli", "console", "--port", "$Port", "--no-browser")
    if ($Live) { $a += "--live" }
    Start-Process -FilePath $Py -ArgumentList $a -WorkingDirectory $Root -WindowStyle Minimized
}

Write-Host "ZAMBAHOLA BETA watchdog: keeping the agent alive on :$Port ($(if($Live){'LIVE'}else{'testnet'}))" -ForegroundColor Green
$miss = 0
while ($true) {
    if (Test-PortListening) {
        $miss = 0
    } else {
        # require TWO consecutive dead checks so a restart already in progress isn't
        # double-launched; only then (re)start the single instance.
        $miss++
        Write-Host "$(Get-Date -Format 'HH:mm:ss')  port :$Port not listening ($miss)" -ForegroundColor Yellow
        if ($miss -ge 2) {
            Write-Host "$(Get-Date -Format 'HH:mm:ss')  -> (re)starting dashboard" -ForegroundColor Yellow
            Start-Dashboard
            $miss = 0
            Start-Sleep -Seconds 30
        }
    }
    [ZbhSleep]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null
    Start-Sleep -Seconds $CheckSeconds
}
