[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Write-Host "Repo: $(Get-Location)"
Write-Host ""

foreach ($name in @("claude","codex","agy")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue

    if (-not $cmd) {
        Write-Host "$name : MISSING" -ForegroundColor Red
        continue
    }

    try {
        $v = & $name --version 2>&1 | Select-Object -First 1
        Write-Host ("{0,-8} {1}" -f $name, $v) -ForegroundColor Green
    } catch {
        Write-Host "$name : FOUND, VERSION CHECK FAILED - $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Git:"
git status --short
git branch --show-current
