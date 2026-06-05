# جمع تقارير Downloads وعمل حزمة واحدة للمراجعة في Cursor
# Usage: .\scripts\collect-downloads-reports.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $Root "apps\one-agent\knowledge\user-reports"
$Downloads = Join-Path $env:USERPROFILE "Downloads"

$Files = @(
    "تنبوء-2.md",
    "ابي تتعمق اكثر وتجيب اكثر عن دقة التنبوء ورفعه.md",
    "ابي كل ما يخص تعلم الاله و التداول بالذكاء الاصطنا.md",
    "ايه.md",
    "ايه بس بدون تدقيق لل قيود لانه انا الي ابكتبها بمل.md"
)

New-Item -ItemType Directory -Force -Path $Dest | Out-Null

$Copied = 0
foreach ($f in $Files) {
    $src = Join-Path $Downloads $f
    if (-not (Test-Path $src)) {
        Write-Host "[skip] not found: $src" -ForegroundColor Yellow
        continue
    }
    $safe = $f -replace '[\\/:*?"<>|]', '-'
    if ($safe.Length -gt 80) { $safe = $safe.Substring(0, 80) + ".md" }
    Copy-Item -Force $src (Join-Path $Dest $safe)
    Write-Host "[ok] $f"
    $Copied++
}

if ($Copied -eq 0) {
    Write-Host "No files copied. Check Downloads paths." -ForegroundColor Red
    exit 1
}

Set-Location $Root
npm run agent:bundle-reports

Write-Host ""
Write-Host "=== ارفع هذا الملف في Cursor ===" -ForegroundColor Green
Write-Host (Join-Path $Dest "BUNDLE-FOR-REVIEW.md")
