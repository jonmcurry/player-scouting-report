[CmdletBinding()]
param(
    [string]$DevUrl = "http://127.0.0.1:4173",
    [string[]]$Routes = @()
)

$ErrorActionPreference = "Stop"

$routeText = if ($Routes.Count -gt 0) {
    ($Routes | ForEach-Object {
        "- $DevUrl/$($_.TrimStart('/'))"
    }) -join "`n"
} else {
    "- Inspect the relevant modified routes discoverable from the current frontend change."
}

$prompt = @"
Perform READ-ONLY visual/product QA for HitterLoop.

Local app:
$DevUrl

Routes:
$routeText

Do not modify code.
Do not commit, push, deploy, reset, or alter cloud data.

If browser automation is available:
- use a real browser;
- inspect mobile around 390-430px;
- inspect desktop around 1280-1440px when relevant;
- inspect DOM and console errors;
- verify rendered behavior, not just source strings.

Evaluate:
- player/parent comprehension;
- coach comprehension;
- information hierarchy;
- Watch -> Understand -> Focus -> Train -> Recheck cohesion;
- repeated empty states;
- contradictory controls;
- terminology;
- dead tabs;
- mobile density;
- speculative metrics/3D;
- whether the next useful action is obvious.

If browser automation is unavailable:
- do not pretend QA passed;
- explicitly report BROWSER QA UNAVAILABLE;
- list what prevented verification.

Otherwise return:
1. Blocking visual/product defects
2. Non-blocking issues
3. Screens/routes verified
4. Console/runtime errors
5. Final verdict: PASS / PASS WITH ISSUES / BLOCKED
"@

Write-Host "Running AGY visual QA..." -ForegroundColor Cyan

agy --mode plan --print-timeout 180s -p $prompt
