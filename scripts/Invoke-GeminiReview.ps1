param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt,
    [string]$Model = "gemini-3.8-flash-high",
    # Measured on the previous default model: a real Gemini 3.1 Pro (High) review of a ~30 KB diff took 197-220s, almost all of it model
    # reasoning (22-31k thinking tokens). The old 180-240s limits cut reviews off just before they
    # finished, so leave real headroom.
    [int]$TimeoutSeconds = 900,
    [string]$Repo = ".",
    # Limit the review diff to these repo-relative paths. Omit to review the whole working tree.
    [string[]]$Paths = @(),
    # Per-file diffs longer than this are excerpted (head + tail). Bulk data files, such as a
    # 4,700-line seed migration, otherwise dominate the payload and the model's reading time.
    [int]$MaxFileDiffLines = 1200,
    # The payload is inlined, so tools are only for spot-checking files that were excerpted or absent.
    # Measured: an agent told to read the diff from disk with "at most 6 files" made 11 reads.
    [int]$MaxReads = 4,
    [int]$HeartbeatSeconds = 30
)

$ErrorActionPreference = "Stop"
# git diff --no-index exits 1 whenever files differ; never let that become a terminating error.
$PSNativeCommandUseErrorActionPreference = $false

# Exit codes: 0 review completed; 2 timed out; 3 no review text; 4 agy reported an error;
# 5 agy not installed; 6 nothing to review.
$agy = Get-Command agy -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $agy) { Write-Host "Gemini/AGY CLI (agy) was not found on PATH." -ForegroundColor Red; exit 5 }

Push-Location -LiteralPath $Repo
try {
    $repoRoot = (git rev-parse --show-toplevel 2>$null)
    if (-not $repoRoot) { Write-Host "Run this from inside a Git repository." -ForegroundColor Red; exit 6 }
    $repoRoot = $repoRoot.Trim()
    Set-Location -LiteralPath $repoRoot

    # `pwsh -File` hands a comma-separated list through as one string.
    $Paths = @($Paths | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $pathArgs = if ($Paths.Count) { @("--") + $Paths } else { @() }

    function Format-Diff([string[]]$lines, [string]$path) {
        if ($lines.Count -le $MaxFileDiffLines) { return ($lines -join "`n") }
        $head = [Math]::Min(150, $MaxFileDiffLines)
        $tail = [Math]::Min(40, [Math]::Max(0, $MaxFileDiffLines - $head))
        $omitted = $lines.Count - $head - $tail
        $script:excerpted += $path
        return (($lines[0..($head - 1)] -join "`n") +
            "`n... [review wrapper omitted $omitted of $($lines.Count) diff lines for $path. " +
            "Open the file only if a finding depends on the omitted part.] ...`n" +
            $(if ($tail -gt 0) { $lines[($lines.Count - $tail)..($lines.Count - 1)] -join "`n" } else { "" }))
    }

    $sections = [System.Collections.Generic.List[string]]::new()
    $script:excerpted = @()
    $deleted = @()

    # Tracked changes, one file at a time so bulk files can be summarised. -z keeps odd paths intact.
    $nameStatus = ((git diff HEAD --no-renames --name-status -z @pathArgs) -join "`n").Split([char]0) |
        ForEach-Object { $_.Trim("`n") } | Where-Object { $_ -ne "" }
    for ($i = 0; $i + 1 -lt $nameStatus.Count; $i += 2) {
        $status = $nameStatus[$i]; $path = $nameStatus[$i + 1]
        if ($status -eq "D") {
            $removed = (git cat-file -p "HEAD:$path" 2>$null | Measure-Object -Line).Lines
            $deleted += $path
            $sections.Add("# deleted file: $path ($removed lines removed; content omitted - it is in HEAD)")
            continue
        }
        $sections.Add((Format-Diff @(git diff HEAD --no-renames -- $path) $path))
    }

    # New files.
    foreach ($file in @(git ls-files --others --exclude-standard @pathArgs)) {
        $fullPath = Join-Path $repoRoot $file
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { continue }
        # Sniff only the head of the file - untracked media can be gigabytes.
        $stream = [System.IO.File]::OpenRead($fullPath)
        try { $head = New-Object byte[] 8192; $read = $stream.Read($head, 0, $head.Length) } finally { $stream.Dispose() }
        if ([Array]::IndexOf($head, [byte]0, 0, $read) -ge 0) { $sections.Add("# untracked binary file omitted: $file"); continue }
        $sections.Add((Format-Diff @(git diff --no-index -- /dev/null $file) $file))
    }

    $payload = ($sections -join "`n") + "`n"
    if (-not $payload.Trim()) {
        Write-Host "No changes to review$(if ($Paths.Count) { " in the given paths" })." -ForegroundColor Yellow
        exit 6
    }

    # Keep the exact payload and the review beside each other for audit, inside the git dir (never
    # tracked; in a worktree .git is a file, so resolve the real git dir).
    $gitDir = (git rev-parse --absolute-git-dir).Trim()
    $reviewDir = Join-Path $gitDir "gemini-review"
    New-Item -ItemType Directory -Force -Path $reviewDir | Out-Null
    Get-ChildItem -LiteralPath $reviewDir -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip 40 | Remove-Item -Force
    $stamp = "{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), [guid]::NewGuid().ToString("N").Substring(0, 6)
    $payloadFile = Join-Path $reviewDir "review-$stamp.diff"
    $resultFile = Join-Path $reviewDir "review-$stamp.md"
    [System.IO.File]::WriteAllText($payloadFile, $payload)

    $scopeNote = if ($Paths.Count) { "Scope: $($Paths -join ', ')" } else { "Scope: whole working tree" }
    $omittedNote = @()
    if ($deleted.Count) { $omittedNote += "Deleted files (content omitted): $($deleted -join ', ')" }
    if ($script:excerpted.Count) { $omittedNote += "Excerpted files (middle omitted): $($script:excerpted -join ', ')" }
    $omittedText = if ($omittedNote.Count) { $omittedNote -join "`n" } else { "Nothing was omitted." }

    $fullPrompt = @"
You are the independent adversarial reviewer for the repository at $repoRoot.

Rules:
- READ ONLY. Do not modify files, run commands, use web/search, or use MCP.
- Tests, source evidence, repository state, and rendered behavior outrank model opinion.
- Classify findings as BLOCKING, NON-BLOCKING, or QUESTION / JUDGMENT CALL.
- Do not invent defects. Cite exact file/path/evidence for each finding. If evidence is insufficient, say so.

How to review:
- The complete change under review (uncommitted diff against HEAD, including new files) is inlined
  below between <review_payload> tags. You do not need any tool to read it.
- Use view_file only to verify a specific suspected defect in a file that was omitted or excerpted,
  or in a related file named in the payload. At most $MaxReads reads in total; never re-read a file;
  never guess file names. Once the budget is spent, write the review with the evidence you have.
- Start directly with the findings.

$scopeNote
$omittedText

Task:
$Prompt

<review_payload>
$payload
</review_payload>

Now write the review for the task above, following the rules.
"@

    $message = @{ event = "user"; message = @{ role = "user"; content = $fullPrompt } } | ConvertTo-Json -Compress -Depth 5

    Write-Host "Running Gemini independent review..." -ForegroundColor Cyan
    Write-Host "Model:   $Model   Timeout: ${TimeoutSeconds}s" -ForegroundColor DarkGray
    Write-Host "Payload: $payloadFile ($(($payload -split "`n").Count) lines, $([Math]::Round($payload.Length / 1KB)) KB)" -ForegroundColor DarkGray
    if ($deleted.Count -or $script:excerpted.Count) { Write-Host $omittedText -ForegroundColor DarkGray }

    # The prompt goes in on stdin (stream-json), not argv: no command-line length limit on any OS,
    # and the model gets the whole change in one turn instead of paging it in through tool calls.
    $agyArgs = @("--mode", "plan", "--model", $Model, "--print-timeout", "${TimeoutSeconds}s",
        "--input-format", "stream-json", "--output-format", "stream-json")
    # A .cmd/.bat shim cannot be started directly with UseShellExecute=false. agy normally installs a
    # real executable; the shim path exists so a different install layout still works.
    if ($agy.Source -match "\.(cmd|bat)$") {
        $psi = [System.Diagnostics.ProcessStartInfo]::new($env:ComSpec)
        foreach ($arg in @("/d", "/c", $agy.Source) + $agyArgs) { $psi.ArgumentList.Add($arg) }
    } else {
        $psi = [System.Diagnostics.ProcessStartInfo]::new($agy.Source)
        foreach ($arg in $agyArgs) { $psi.ArgumentList.Add($arg) }
    }
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardInputEncoding = [System.Text.UTF8Encoding]::new($false)
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $psi.WorkingDirectory = $repoRoot

    $proc = [System.Diagnostics.Process]::Start($psi)
    # Start draining stdout/stderr before sending the (possibly large) prompt, and send it
    # asynchronously, so neither side can block on a full pipe buffer while the other waits.
    $outTask = $proc.StandardOutput.ReadLineAsync()
    $errTask = $proc.StandardError.ReadLineAsync()
    $inputBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($message + "`n")
    $writeTask = $proc.StandardInput.BaseStream.WriteAsync($inputBytes, 0, $inputBytes.Length)
    $inputClosed = $false

    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $state = @{ TimedOut = $false; Result = $null; Reads = 0; Thinking = 0; Other = [System.Collections.Generic.List[string]]::new() }
    function Write-Progress-Line([string]$text) {
        Write-Host ("[gemini {0:mm\:ss}] {1}" -f $clock.Elapsed, $text) -ForegroundColor DarkGray
    }
    function Read-AgyLine([string]$line) {
        try { $evt = $line | ConvertFrom-Json -ErrorAction Stop } catch {
            # Only agy's own plain-text status lines reach here (review text arrives inside JSON
            # events), so an unanchored, ANSI-stripped match cannot be triggered by quoted review text.
            $plain = $line -replace "\x1b\[[0-9;]*[A-Za-z]", ""
            if ($plain -match "\[agy\] print timeout after") { $state.TimedOut = $true; Write-Host $plain -ForegroundColor Yellow }
            elseif ($plain.Trim()) { $state.Other.Add($plain) }
            return
        }
        switch ($evt.event) {
            "init" { Write-Progress-Line "session started ($($evt.init.model))" }
            "step_update" {
                $s = $evt.step_update
                if ($s.state -ne "DONE") { return }
                if ($s.step_type -eq "agent_response") {
                    $t = [int]($s.usage.thinking_tokens)
                    $state.Thinking += $t
                    Write-Progress-Line ("reasoning step finished in {0:N0}s ({1} thinking tokens)" -f $s.duration_seconds, $t)
                } elseif ($s.step_type -eq "tool") {
                    if ($s.tool_name -eq "view_file") { $state.Reads++ }
                    $target = $s.tool_info.parameters.AbsolutePath
                    Write-Progress-Line ("tool {0}{1}" -f $s.tool_name, $(if ($target) { ": $target" } else { "" }))
                }
            }
            "result" { $state.Result = $evt.result }
        }
    }

    $outDone = $false; $errDone = $false
    $lastActivity = $clock.Elapsed
    # agy enforces --print-timeout itself; this is only a backstop if agy hangs past it.
    $hardStop = [TimeSpan]::FromSeconds($TimeoutSeconds + 60)
    while (-not ($outDone -and $errDone)) {
        if (-not $inputClosed -and $writeTask.IsCompleted) {
            # Closing stdin ends the stream-json input, which tells agy the prompt is complete.
            try { $proc.StandardInput.Close() } catch { }
            $inputClosed = $true
        }
        # Block on whichever stream is still open (never spin when one has already ended).
        $pending = @()
        if (-not $outDone) { $pending += $outTask }
        if (-not $errDone) { $pending += $errTask }
        [void][System.Threading.Tasks.Task]::WaitAny([System.Threading.Tasks.Task[]]$pending, 250)
        $progressed = $false
        if (-not $outDone -and $outTask.IsCompleted) {
            $line = $outTask.Result
            if ($null -eq $line) { $outDone = $true } else { Read-AgyLine $line; $outTask = $proc.StandardOutput.ReadLineAsync() }
            $progressed = $true
        }
        if (-not $errDone -and $errTask.IsCompleted) {
            $line = $errTask.Result
            if ($null -eq $line) { $errDone = $true } else { Read-AgyLine $line; $errTask = $proc.StandardError.ReadLineAsync() }
            $progressed = $true
        }
        if ($progressed) { $lastActivity = $clock.Elapsed; continue }
        if (($clock.Elapsed - $lastActivity).TotalSeconds -ge $HeartbeatSeconds) {
            Write-Progress-Line "still reviewing (model is reasoning; no output yet)"
            $lastActivity = $clock.Elapsed
        }
        if ($clock.Elapsed -gt $hardStop) {
            Write-Host "agy did not stop at its own timeout; killing it." -ForegroundColor Red
            try { $proc.Kill($true) } catch { }
            $state.TimedOut = $true
            break
        }
    }
    $proc.WaitForExit(10000) | Out-Null
    $agyExit = if ($proc.HasExited) { $proc.ExitCode } else { -1 }

    $result = $state.Result
    $response = if ($result) { "$($result.response)" } else { "" }
    $usage = if ($result -and $result.usage) {
        "{0} turn(s), {1} input / {2} output / {3} thinking tokens" -f $result.num_turns, $result.usage.input_tokens,
            $result.usage.output_tokens, $result.usage.thinking_tokens
    } else { "no usage reported" }
    $summary = "{0:N0}s elapsed, {1} file read(s), {2}" -f $clock.Elapsed.TotalSeconds, $state.Reads, $usage

    # agy exits 0 and reports status SUCCESS with an empty response when its print timeout fires,
    # so the timeout line is the only reliable signal.
    if ($state.TimedOut) {
        Write-Host "Gemini review did NOT complete: timed out after ${TimeoutSeconds}s ($summary)." -ForegroundColor Red
        if ($response.Trim()) { Write-Host "Partial output (not a completed review):" -ForegroundColor Yellow; Write-Host $response }
        Write-Host "Retry with a larger -TimeoutSeconds or a narrower -Paths list." -ForegroundColor Yellow
        exit 2
    }
    if (-not $result -or $result.status -ne "SUCCESS" -or $agyExit -ne 0) {
        $err = if ($result -and $result.error) { $result.error } elseif ($state.Other.Count) { $state.Other -join "`n" } else { "no result event" }
        Write-Host "Gemini review failed (agy exit $agyExit, status $(if ($result) { $result.status } else { 'none' })): $err" -ForegroundColor Red
        exit 4
    }
    if (-not $response.Trim()) {
        Write-Host "Gemini review did NOT complete: agy returned no review text ($summary)." -ForegroundColor Red
        exit 3
    }

    [System.IO.File]::WriteAllText($resultFile, $response)
    Write-Host "Gemini review completed ($summary). Saved to $resultFile" -ForegroundColor Green
    Write-Output $response
    exit 0
}
finally {
    Pop-Location
}
