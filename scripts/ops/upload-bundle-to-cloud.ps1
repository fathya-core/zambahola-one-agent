# ارفع BUNDLE-FOR-REVIEW.md للسحابة (git push) — يقرأه Cloud Agent بعد pull
# Usage: .\scripts\ops\upload-bundle-to-cloud.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Bundle = Join-Path $Root "apps\one-agent\knowledge\user-reports\BUNDLE-FOR-REVIEW.md"

if (-not (Test-Path $Bundle)) {
    Write-Host "Bundle not found. Run first:" -ForegroundColor Yellow
    Write-Host "  .\scripts\ops\collect-downloads-reports.ps1"
    exit 1
}

Set-Location $Root
git add "apps/one-agent/knowledge/user-reports/BUNDLE-FOR-REVIEW.md"
git add "apps/one-agent/knowledge/user-reports/BUNDLE-PREVIEW.json" -ErrorAction SilentlyContinue

$status = git status --porcelain
if (-not $status) {
    Write-Host "Nothing new to upload (already committed?)." -ForegroundColor Yellow
    exit 0
}

git commit -m "upload: research bundle for cloud AI review"
git push origin main

Write-Host ""
Write-Host "Done. In Cloud Agent chat write:" -ForegroundColor Green
Write-Host "  راجع apps/one-agent/knowledge/user-reports/BUNDLE-FOR-REVIEW.md"
