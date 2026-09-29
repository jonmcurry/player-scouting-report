param(
    [Parameter(Mandatory = $true)]
    [string]$ReviewPrompt,
    [switch]$SkipTests,
    [string]$GeminiModel = "gemini-3.1-pro-high"
)

$ErrorActionPreference = "Stop"
$repo = git rev-parse --show-toplevel 2>$null
if (-not $repo) { throw "Run this from inside the HitterLoop repository." }

Write-Host ""
Write-Host "=== HitterLoop Orchestrated QA ===" -ForegroundColor Cyan
Write-Host "Claude = orchestrator / implementer" -ForegroundColor DarkGray
Write-Host "Gemini = independent reviewer" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Git status:" -ForegroundColor Cyan
git status --short

if (-not $SkipTests) {
    Write-Host ""
    Write-Host "Running repository validation..." -ForegroundColor Cyan
    if (Test-Path (Join-Path $repo "package.json")) {
        npm test
        if ($LASTEXITCODE -ne 0) { throw "npm test failed." }
        $pkg = Get-Content (Join-Path $repo "package.json") -Raw | ConvertFrom-Json
        if ($pkg.scripts.PSObject.Properties.Name -contains "test:coach") {
            npm run test:coach
            if ($LASTEXITCODE -ne 0) { throw "coach test suite failed." }
        }
        if ($pkg.scripts.PSObject.Properties.Name -contains "test:demo-real-fixture") {
            npm run test:demo-real-fixture
            if ($LASTEXITCODE -ne 0) { throw "test:demo-real-fixture failed." }
        }
        if ($pkg.scripts.PSObject.Properties.Name -contains "typecheck") {
            npm run typecheck
            if ($LASTEXITCODE -ne 0) { throw "typecheck failed." }
        } else {
            npx tsc --noEmit
            if ($LASTEXITCODE -ne 0) { throw "tsc --noEmit failed." }
        }
    }
    git diff --check
    if ($LASTEXITCODE -ne 0) { throw "git diff --check failed." }
}

Write-Host ""
Write-Host "Running Gemini review..." -ForegroundColor Cyan
$reviewScript = Join-Path $PSScriptRoot "Invoke-GeminiReview.ps1"
& $reviewScript -Prompt $ReviewPrompt -Model $GeminiModel
if ($LASTEXITCODE -ne 0) { throw "Gemini review failed or was unavailable." }

Write-Host ""
Write-Host "Orchestrated QA finished." -ForegroundColor Green
Write-Host "Claude should now reconcile Gemini findings against code/tests/evidence." -ForegroundColor Green
