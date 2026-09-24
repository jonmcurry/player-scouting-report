<#
.SYNOPSIS
    Sets up repo-local Claude Code + Codex CLI + Antigravity (agy) orchestration.

.DESCRIPTION
    Run this after Node.js, Claude Code, Codex CLI, agy, and your Multiclaude setup are already installed/authenticated.

    It:
      - verifies claude/codex/agy
      - creates or updates CLAUDE.md with the multi-agent contract
      - creates helper scripts for Codex review, AGY visual QA, and combined QA
      - creates specs/README.md
      - adds .agent-tmp/ to .gitignore
      - never commits, pushes, deploys, resets, or changes cloud state

.PARAMETER RepoRoot
    Project root. Defaults to the current directory.

.PARAMETER Force
    Overwrite generated helper files if they already exist.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = (Get-Location).Path,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Require-Command {
    param([string]$Name)

    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "Required command '$Name' was not found on PATH."
    }

    try {
        $versionOutput = & $Name --version 2>&1 | Select-Object -First 1
    } catch {
        $versionOutput = "(version check failed: $($_.Exception.Message))"
    }

    Write-Host ("  {0,-8} {1}" -f $Name, $versionOutput) -ForegroundColor Green
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Write-GeneratedFile {
    param(
        [string]$Path,
        [string]$Content
    )

    if ((Test-Path $Path) -and -not $Force) {
        Write-Host "  Skipped existing file: $Path" -ForegroundColor Yellow
        return
    }

    $parent = Split-Path -Parent $Path
    if ($parent) {
        Ensure-Directory $parent
    }

    Set-Content -Path $Path -Value $Content -Encoding UTF8
    Write-Host "  Wrote: $Path" -ForegroundColor Green
}

function Update-ClaudeMd {
    param([string]$Path)

    $start = "<!-- BEGIN HITTERLOOP MULTI-AGENT MANAGED BLOCK -->"
    $end   = "<!-- END HITTERLOOP MULTI-AGENT MANAGED BLOCK -->"

    $block = @"
$start
# Multi-Agent Orchestration & Division of Labor

## Team Hierarchy
- **Product Manager / Spec Synthesizer:** User. Final authority on product decisions.
- **Senior Implementation Engineer:** Claude Code. Implements approved specs across the repo.
- **Adversarial Reviewer & Tester:** Codex CLI. Reviews uncommitted diffs, tests, regressions, and edge cases.
- **Visual QA & Product Review:** Antigravity CLI (`agy`) + Gemini. Reviews rendered UI, browser behavior, layout, and product coherence.

## Core Workflow
1. **Spec**
   - Read the user's spec or a file under `specs/`.
   - Resolve material ambiguity before coding.

2. **Implement — Claude**
   - Inspect `git status` and the existing diff before editing.
   - Preserve unrelated work.
   - Implement the smallest coherent change.
   - Run focused and broad tests as appropriate.
   - Do not claim visual UX success from tests alone.

3. **Adversarial Review — Codex**
   - Review the uncommitted diff and tests.
   - Assume the implementer's completion report may be wrong.
   - Look for logic errors, security/privacy issues, edge cases, regressions, missing tests, and unmet acceptance criteria.

4. **Visual QA — AGY/Gemini**
   - For UI work, inspect the rendered application in a real browser when available.
   - Check mobile/desktop layout, console errors, contradictory controls, terminology, hierarchy, and user comprehension.
   - If browser automation is unavailable, mark visual QA as pending.

5. **User Sign-Off**
   - Summarize implementation, Codex findings, AGY/Gemini QA, tests, and remaining risks.
   - Do not commit, push, deploy, or change cloud state unless explicitly authorized in the current task.

## HitterLoop Product Contract
Core loop:

**WATCH → UNDERSTAND → FOCUS → TRAIN → RECHECK**

The original swing video is the source of truth.
The coach is the final authority.

Prioritize:
- what is working;
- what needs attention;
- evidence;
- next development step;
- Priority;
- Drill;
- Practice;
- Progress.

De-emphasize:
- batting result;
- pitch location;
- count;
- game outcome metadata;
- speculative metrics;
- experimental 3D;
- implementation/debug terminology.

Truth rules:
- never invent observations/findings;
- never invent Priorities;
- never invent Drills;
- never invent progress;
- never invent metrics;
- insufficient evidence fails closed;
- AI drafts are not coach conclusions.

## Engineering Safety Rules
Before editing:
- inspect repo and branch;
- inspect `git status`;
- inspect existing uncommitted diff;
- preserve unrelated user work.

Never unless explicitly authorized:
- `git reset --hard`;
- discard local changes;
- overwrite user work;
- commit;
- push;
- deploy;
- alter cloud data;
- change canonical fixture pointers.

## Review Gates

### Codex gate
Run:
`powershell -ExecutionPolicy Bypass -File .\scripts\Invoke-CodexReview.ps1`

### Visual QA gate
For frontend work:
`powershell -ExecutionPolicy Bypass -File .\scripts\Invoke-AgyVisualQA.ps1`

If browser automation is unavailable, report:
**MANUAL VISUAL QA REQUIRED**

## Final Handoff
Before asking for release approval, provide:
- files changed;
- tests run and results;
- Codex review result;
- AGY/Gemini visual QA result;
- known limitations;
- `git status`;
- anything still unverified.
$end
"@

    if (-not (Test-Path $Path)) {
        Set-Content -Path $Path -Value $block -Encoding UTF8
        Write-Host "  Created: $Path" -ForegroundColor Green
        return
    }

    $existing = Get-Content -Raw -Path $Path

    $escapedStart = [regex]::Escape($start)
    $escapedEnd   = [regex]::Escape($end)
    $pattern = "(?s)$escapedStart.*?$escapedEnd"

    if ($existing -match $pattern) {
        $updated = [regex]::Replace(
            $existing,
            $pattern,
            [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $block },
            1
        )
        Set-Content -Path $Path -Value $updated -Encoding UTF8
        Write-Host "  Updated managed block in: $Path" -ForegroundColor Green
    } else {
        $backup = "$Path.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Copy-Item $Path $backup

        Add-Content -Path $Path -Value "`r`n`r`n$block" -Encoding UTF8

        Write-Host "  Existing CLAUDE.md preserved; backup: $backup" -ForegroundColor Yellow
        Write-Host "  Appended managed block to: $Path" -ForegroundColor Green
    }
}

# Resolve repo
$RepoRoot = (Resolve-Path $RepoRoot).Path
Set-Location $RepoRoot

Write-Step "Preflight"

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
    throw "RepoRoot does not look like a Git repository: $RepoRoot"
}

Write-Host "  Repo: $RepoRoot"
Write-Host "  Branch: $(& git branch --show-current)"
Write-Host "  Git status:"
& git status --short

Write-Step "Verify required CLIs"

Require-Command "claude"
Require-Command "codex"
Require-Command "agy"

Write-Step "Create/update CLAUDE.md"

Update-ClaudeMd -Path (Join-Path $RepoRoot "CLAUDE.md")

$ScriptsDir = Join-Path $RepoRoot "scripts"
$SpecsDir   = Join-Path $RepoRoot "specs"
$AgentTmp   = Join-Path $RepoRoot ".agent-tmp"

Write-Step "Create helper directories"

Ensure-Directory $ScriptsDir
Ensure-Directory $SpecsDir
Ensure-Directory $AgentTmp

# ------------------------------------------------------------
# Tool smoke test
# ------------------------------------------------------------

$smoke = @'
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
'@

Write-GeneratedFile `
    -Path (Join-Path $ScriptsDir "Test-AgentTooling.ps1") `
    -Content $smoke

# ------------------------------------------------------------
# Codex review helper
# ------------------------------------------------------------

$codexReview = @'
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
'@

Write-GeneratedFile `
    -Path (Join-Path $ScriptsDir "Invoke-CodexReview.ps1") `
    -Content $codexReview

# ------------------------------------------------------------
# AGY visual QA helper
# ------------------------------------------------------------

$agyQa = @'
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

agy run $prompt
'@

Write-GeneratedFile `
    -Path (Join-Path $ScriptsDir "Invoke-AgyVisualQA.ps1") `
    -Content $agyQa

# ------------------------------------------------------------
# Combined QA helper
# ------------------------------------------------------------

$combined = @'
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
'@

Write-GeneratedFile `
    -Path (Join-Path $ScriptsDir "Invoke-MultiAgentQA.ps1") `
    -Content $combined

# ------------------------------------------------------------
# Specs README
# ------------------------------------------------------------

$specReadme = @'
# Specs

Put durable feature/product specs here.

Suggested workflow:

1. Create a focused spec:

   specs/<feature-name>.md

2. Ask Claude Code:

   Implement specs/<feature-name>.md. Follow CLAUDE.md. Stop before commit/push/deploy.

3. Run:

   powershell -ExecutionPolicy Bypass -File .\scripts\Invoke-MultiAgentQA.ps1

4. Review:
   - implementation summary
   - Codex adversarial findings
   - AGY/Gemini visual QA
   - manual screenshots if visual automation is unavailable

5. Only then authorize commit/push/deploy.

Suggested spec structure:

# Feature

## Goal

## User story

## Current behavior

## Desired behavior

## Data truth / constraints

## UX states

## Acceptance criteria

## Non-goals

## Tests required

## Release / rollback notes
'@

Write-GeneratedFile `
    -Path (Join-Path $SpecsDir "README.md") `
    -Content $specReadme

# ------------------------------------------------------------
# Ignore local scratch files
# ------------------------------------------------------------

$gitignorePath = Join-Path $RepoRoot ".gitignore"

if (Test-Path $gitignorePath) {

    $ignore = Get-Content -Raw $gitignorePath

    if ($ignore -notmatch "(?m)^\.agent-tmp/\s*$") {

        Add-Content `
            -Path $gitignorePath `
            -Value "`r`n# Local multi-agent QA scratch files`r`n.agent-tmp/" `
            -Encoding UTF8

        Write-Host "  Added .agent-tmp/ to .gitignore" -ForegroundColor Green
    }

} else {

    Set-Content `
        -Path $gitignorePath `
        -Value "# Local multi-agent QA scratch files`r`n.agent-tmp/" `
        -Encoding UTF8

    Write-Host "  Created .gitignore with .agent-tmp/" -ForegroundColor Green
}

# ------------------------------------------------------------
# Smoke test
# ------------------------------------------------------------

Write-Step "Smoke test"

& (Join-Path $ScriptsDir "Test-AgentTooling.ps1")

Write-Step "Done"

Write-Host @"

Multi-agent repo setup is ready.

Created/updated:

  CLAUDE.md
  scripts\Test-AgentTooling.ps1
  scripts\Invoke-CodexReview.ps1
  scripts\Invoke-AgyVisualQA.ps1
  scripts\Invoke-MultiAgentQA.ps1
  specs\README.md

Suggested next steps:

1. Review generated files:

   git diff -- CLAUDE.md scripts specs .gitignore

2. Start your local app/server.

3. Ask Claude Code to implement a spec:

   claude

4. Before commit:

   powershell -ExecutionPolicy Bypass -File .\scripts\Invoke-MultiAgentQA.ps1

Nothing was committed, pushed, or deployed by this setup script.
"@ -ForegroundColor Green