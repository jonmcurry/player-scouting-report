param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt,
    [string]$Model = "gemini-3.1-pro-high",
    [int]$TimeoutSeconds = 360
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command agy -ErrorAction SilentlyContinue)) { throw "Gemini/AGY CLI not found on PATH." }
$repo = git rev-parse --show-toplevel 2>$null
if (-not $repo) { throw "Run this from inside the HitterLoop repository." }

Write-Host "Running Gemini independent review..." -ForegroundColor Cyan
Write-Host "Model: $Model" -ForegroundColor DarkGray
Write-Host "Repo:  $repo" -ForegroundColor DarkGray

$fullPrompt = @"
You are the independent adversarial reviewer for this repository.

Rules:
- READ ONLY.
- Do not modify files.
- Do not run commands.
- Do not use web/search.
- Do not use MCP.
- Use view_file only for repository/image evidence.
- Tests, source evidence, repository state, and rendered behavior outrank model opinion.
- Classify findings as BLOCKING, NON-BLOCKING, or QUESTION / JUDGMENT CALL.
- Do not invent defects. Cite exact file/path/evidence for each finding.
- If evidence is insufficient, say so.

Task:
$Prompt
"@

agy --mode plan --model $Model --print-timeout "${TimeoutSeconds}s" -p $fullPrompt
