[CmdletBinding()]
param(
    [switch]$SkipTests,
    [switch]$SkipVisual,
    [string]$DevUrl = "http://127.0.0.1:4173"
)

$ErrorActionPreference = "Stop"

Write-Host "`n=== PRE-COMMIT MULTI-AGENT QA ===" -ForegroundColor Cyan
Write-Host "This script does NOT commit, push, or deploy.`n"

Write-Host "Git status:" -ForegroundColor Cyan
git status --short

if (-not $SkipTests) {
    Write-Host "`nRunning npm test..." -ForegroundColor Cyan

    npm test

    if ($LASTEXITCODE -ne 0) {
        throw "npm test failed."
    }
}

Write-Host "`nRunning Codex review..." -ForegroundColor Cyan

& (Join-Path $PSScriptRoot "Invoke-CodexReview.ps1")

if (-not $SkipVisual) {
    Write-Host "`nRunning AGY visual QA..." -ForegroundColor Cyan

    & (Join-Path $PSScriptRoot "Invoke-AgyVisualQA.ps1") `
        -DevUrl $DevUrl
}

Write-Host "`n=== QA ORCHESTRATION COMPLETE ===" -ForegroundColor Green
Write-Host "No commit/push/deploy was performed."
