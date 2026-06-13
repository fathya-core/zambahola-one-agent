# تعليمات تثبيت Cursor Marketplace لـ ZAMBAHOLA
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

Write-Host "=== ZAMBAHOLA — Cursor Marketplace ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "السحابة لا تستطيع الضغط على Marketplace عندك." -ForegroundColor Yellow
Write-Host "انسخ الأوامر التالية في شات Cursor (سطر لكل سطر):" -ForegroundColor Green
Write-Host ""

$plugins = @(
    "tavily",
    "zapier",
    "huggingface-skills",
    "cli-for-agent",
    "cursor-sdk",
    "agent-compatibility",
    "continual-learning"
)

foreach ($p in $plugins) {
    Write-Host "/add-plugin $p" -ForegroundColor White
}

Write-Host ""
Write-Host "ثم:" -ForegroundColor Cyan
Write-Host "  1) Settings -> Tools & MCP -> Connect (zapier, huggingface, tavily)"
Write-Host "  2) .\scripts\windows\install-local-stack.ps1   (ينسخ mcp.json)"
Write-Host "  3) npm run agent:health-check"
Write-Host ""
Write-Host "الدليل الكامل: docs\ar\تثبيت-اضافات-السوق.md" -ForegroundColor Green

$doc = Join-Path $Root "docs\ar\تثبيت-اضافات-السوق.md"
if (Test-Path $doc) {
    Start-Process $doc
}
