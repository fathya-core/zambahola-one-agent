# تسجيل Phase 5 في Windows Task Scheduler — يشتغل عند تسجيل الدخول
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$TaskName = "ZAMBAHOLA-Phase5-Auto"
$Ps1 = Join-Path $Root "scripts\phase5-auto.ps1"

Write-Host "=== Install scheduled task: $TaskName ===" -ForegroundColor Cyan

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force

Write-Host "Done. Task runs at logon. To remove: Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false" -ForegroundColor Green
