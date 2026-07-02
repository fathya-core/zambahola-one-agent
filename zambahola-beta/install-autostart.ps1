# Makes ZAMBAHOLA launch automatically at every Windows logon — NO admin needed.
# Drops a launcher into the per-user Startup folder. Run ONCE:
#
#   powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
#
# To remove:  delete "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ZAMBAHOLA.cmd"

$ErrorActionPreference = "Stop"
$Root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $Root "autostart.ps1"
$Startup  = [Environment]::GetFolderPath("Startup")
$Cmd      = Join-Path $Startup "ZAMBAHOLA.cmd"

# a .cmd in the Startup folder DOES auto-run at logon (a .ps1 would just open in an editor)
$body = "@echo off`r`n" +
        "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`"`r`n"
Set-Content -Path $Cmd -Value $body -Encoding ASCII

Write-Host "Installed hands-off auto-start:"
Write-Host "  $Cmd"
Write-Host "ZAMBAHOLA will now come up automatically every time you log in."
Write-Host "Starting it now too..."
& powershell -NoProfile -ExecutionPolicy Bypass -File $Launcher
