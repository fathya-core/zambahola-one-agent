# Keep Windows awake during phase5 (AC + battery + kernel API)
function Enable-Phase5KeepAwake {
    Write-Host "Keep-awake: disabling sleep/hibernate (AC + DC)..." -ForegroundColor Cyan
    try {
        powercfg /change standby-timeout-ac 0 | Out-Null
        powercfg /change standby-timeout-dc 0 | Out-Null
        powercfg /change monitor-timeout-ac 0 | Out-Null
        powercfg /change monitor-timeout-dc 60 | Out-Null
        powercfg /change hibernate-timeout-ac 0 | Out-Null
        powercfg /change hibernate-timeout-dc 0 | Out-Null
        powercfg /hibernate off | Out-Null
        Write-Host "Keep-awake: powercfg OK (plug laptop into power)." -ForegroundColor Green
    }
    catch {
        Write-Host "Keep-awake: powercfg failed - set Never sleep in Windows Settings." -ForegroundColor Yellow
    }

    try {
        if (-not ([System.Management.Automation.PSTypeName]"ZambaholaPower").Type) {
            Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ZambaholaPower {
  [DllImport("kernel32.dll", CharSet=CharSet.Auto, SetLastError=true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
  public const uint ES_CONTINUOUS = 0x80000000;
  public const uint ES_SYSTEM_REQUIRED = 0x00000001;
  public const uint ES_DISPLAY_REQUIRED = 0x00000002;
}
"@
        }
        $flags = [ZambaholaPower]::ES_CONTINUOUS -bor [ZambaholaPower]::ES_SYSTEM_REQUIRED
        [void][ZambaholaPower]::SetThreadExecutionState($flags)
        Write-Host "Keep-awake: SetThreadExecutionState active (PC stays on while this window runs)." -ForegroundColor Green
    }
    catch {
        Write-Host "Keep-awake: API fallback failed - use Windows Never sleep." -ForegroundColor Yellow
    }
}
