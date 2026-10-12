param(
    [Parameter(Mandatory = $true)]
    [string]$ReviewPrompt,
    [switch]$SkipTests,
    [string]$GeminiModel = "gemini-3.1-pro-high",
    [int]$TimeoutSeconds = 900,
    [string[]]$Paths = @()
)

$ErrorActionPreference = "Stop"
$repo = git rev-parse --show-toplevel 2>$null
if (-not $repo) { throw "Run this from inside the HitterLoop repository." }

Write-Host ""
Write-Host "=== HitterLoop Orchestrated QA ===" -ForegroundColor Cyan
Write-Host "Codex = orchestrator / implementer" -ForegroundColor DarkGray
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
& $reviewScript -Prompt $ReviewPrompt -Model $GeminiModel -TimeoutSeconds $TimeoutSeconds -Paths $Paths
$reviewExit = $LASTEXITCODE
$reason = switch ($reviewExit) {
    0 { $null }
    2 { "timed out after ${TimeoutSeconds}s - retry with a larger -TimeoutSeconds or a narrower -Paths list" }
    3 { "agy returned no review text" }
    4 { "agy reported an error (see output above)" }
    5 { "agy is not installed or not on PATH" }
    6 { "there were no changes to review" }
    default { "exit code $reviewExit" }
}
if ($reason) { throw "Gemini review did not complete: $reason." }

Write-Host ""
Write-Host "Orchestrated QA finished." -ForegroundColor Green
Write-Host "Codex should now reconcile Gemini findings against code/tests/evidence." -ForegroundColor Green
