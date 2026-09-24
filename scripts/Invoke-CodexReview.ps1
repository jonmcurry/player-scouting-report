[CmdletBinding()]
param(
    [string]$ExtraContext = ""
)

$ErrorActionPreference = "Stop"

$repo = (Get-Location).Path
$tmpDir = Join-Path $repo ".agent-tmp"

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$diffPath = Join-Path $tmpDir "codex-review.diff"
$promptPath = Join-Path $tmpDir "codex-review-prompt.txt"

git diff --binary | Set-Content -Path $diffPath -Encoding UTF8

if ((Get-Item $diffPath).Length -eq 0) {
    Write-Host "No uncommitted tracked diff to review." -ForegroundColor Yellow
    exit 0
}

$prompt = @"
Perform an adversarial, read-only review of the current HitterLoop changes.

Repository:
$repo

Read the diff file:
$diffPath

Do not modify files.
Do not commit, push, deploy, reset, stash, or alter cloud state.

Assume the implementer's completion report may be wrong.

Check for:
- logic defects;
- security/privacy regressions;
- broken state derivation;
- misleading UX states;
- missing edge cases;
- regressions;
- tests that assert implementation rather than behavior;
- acceptance criteria not actually satisfied;
- accidental changes outside intended scope.

For frontend changes, explicitly check:
- sparse states tell the user what is known and what to do next;
- insufficient evidence fails closed;
- AI draft state is not presented as coach truth;
- unreliable metrics/3D are not overexposed;
- Priority, Drill, Practice, and Progress remain coherently connected.

$ExtraContext

Return:
1. BLOCKING findings
2. NON-BLOCKING findings
3. Tests missing
4. What you verified
5. NOT VERIFIED
6. Final verdict: PASS / PASS WITH ISSUES / BLOCKED
"@

Set-Content -Path $promptPath -Value $prompt -Encoding UTF8

Write-Host "Running Codex adversarial review..." -ForegroundColor Cyan

Get-Content -Raw $promptPath | codex exec -
