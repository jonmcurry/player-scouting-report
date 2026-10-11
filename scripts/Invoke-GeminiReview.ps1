param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt,
    [string]$Model = "gemini-3.1-pro-high",
    [int]$TimeoutSeconds = 600,
    # Limit the review diff to these repo-relative paths. Omit to review the whole working tree.
    [string[]]$Paths = @()
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command agy -ErrorAction SilentlyContinue)) { throw "Gemini/AGY CLI not found on PATH." }
$repo = git rev-parse --show-toplevel 2>$null
if (-not $repo) { throw "Run this from inside the HitterLoop repository." }
Set-Location -LiteralPath $repo

Write-Host "Running Gemini independent review..." -ForegroundColor Cyan
Write-Host "Model: $Model" -ForegroundColor DarkGray
Write-Host "Repo:  $repo" -ForegroundColor DarkGray

# Gemini is not allowed to run commands, so without this it has no `git diff` and
# reconstructs the change by reading whole files one tool call at a time - on a
# large working tree that never finishes inside the print timeout. Hand it the
# diff as one file under .git/ (never tracked) instead.
# `pwsh -File` hands a comma-separated list through as one string.
$Paths = @($Paths | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$pathArgs = if ($Paths.Count) { @("--") + $Paths } else { @() }
$diff = (git diff HEAD @pathArgs) -join "`n"
$untracked = git ls-files --others --exclude-standard @pathArgs
foreach ($file in $untracked) {
    $fullPath = Join-Path $repo $file
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { continue }
    # Sniff only the head of the file - untracked media can be gigabytes.
    $stream = [System.IO.File]::OpenRead($fullPath)
    try { $head = New-Object byte[] 8192; $read = $stream.Read($head, 0, $head.Length) } finally { $stream.Dispose() }
    if ([Array]::IndexOf($head, [byte]0, 0, $read) -ge 0) { $diff += "`n# untracked binary file omitted: $file`n"; continue }
    $diff += "`n" + ((git diff --no-index -- /dev/null $file) -join "`n")
}
if (-not $diff.Trim()) { throw "No changes to review$(if ($Paths.Count) { " in the given paths" })." }
# In a worktree .git is a file, so resolve the real git dir (never tracked either way).
$gitDir = (git rev-parse --absolute-git-dir).Trim()
$reviewDir = Join-Path $gitDir "gemini-review"
New-Item -ItemType Directory -Force -Path $reviewDir | Out-Null
Get-ChildItem -LiteralPath $reviewDir -Filter "review-*.diff" | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 20 | Remove-Item -Force
$diffFile = Join-Path $reviewDir ("review-{0}-{1}.diff" -f (Get-Date -Format "yyyyMMdd-HHmmss"), [guid]::NewGuid().ToString("N").Substring(0, 6))
[System.IO.File]::WriteAllText($diffFile, $diff + "`n")
$repoFull = [System.IO.Path]::GetFullPath($repo)
$insideRepo = $diffFile.StartsWith($repoFull, [StringComparison]::OrdinalIgnoreCase)
$diffRel = if ($insideRepo) { [System.IO.Path]::GetRelativePath($repoFull, $diffFile) -replace "\\", "/" } else { $diffFile }
$addDirArgs = if ($insideRepo) { @() } else { @("--add-dir", $reviewDir) }
Write-Host "Diff:  $diffRel ($(($diff -split "`n").Count) lines)" -ForegroundColor DarkGray

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

The complete change under review (uncommitted diff against HEAD, including new files) is in
$diffRel. Read that file first with view_file - it is authoritative for what changed. Open other
repository files only to verify a specific suspected defect: at most 6 other files in total, never
re-read a file, and never guess file names (you cannot list directories - use only paths that
appear in the diff or in the task). Unbounded exploration makes this review time out with no
result, so once the budget is spent, write your findings with the evidence you have.

Task:
$Prompt
"@

agy --mode plan --model $Model --print-timeout "${TimeoutSeconds}s" @addDirArgs -p $fullPrompt 2>&1 | Tee-Object -Variable captured | Out-Host
$agyExit = $LASTEXITCODE
$capturedText = ($captured | ForEach-Object { "$_" }) -join "`n"
# agy exits 0 on a print timeout and returns partial output; that is not a completed review.
# Match only agy's own status line - a review can legitimately quote this text.
if ($capturedText -match "(?m)^\[agy\] print timeout after") {
    Write-Host "Gemini review did NOT complete: agy hit the ${TimeoutSeconds}s print timeout." -ForegroundColor Red
    exit 2
}
if ($agyExit -ne 0) {
    Write-Host "Gemini review failed: agy exited $agyExit." -ForegroundColor Red
    exit $agyExit
}
if (-not $capturedText.Trim()) {
    Write-Host "Gemini review did NOT complete: agy returned no output." -ForegroundColor Red
    exit 3
}
exit 0
