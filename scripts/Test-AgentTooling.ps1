$ErrorActionPreference = "Stop"
$required = @("claude", "agy")
$missing = @()
foreach ($tool in $required) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $missing += $tool }
}
if ($missing.Count -gt 0) { throw "Required tool(s) not found: $($missing -join ', ')" }
Write-Host "Claude and Gemini/AGY tooling available." -ForegroundColor Green
Write-Host ""
Write-Host "Claude:" -ForegroundColor Cyan
claude --version
Write-Host ""
Write-Host "Gemini/AGY:" -ForegroundColor Cyan
agy --version
