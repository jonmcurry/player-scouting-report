<#
.SYNOPSIS
  Generates a placeholder ("awaiting video") team_summary.html + one page per player,
  for ANY team roster - not hardcoded to one team. This is the shared engine; each real
  team has a thin config script in scripts/teams/ that just defines its roster and calls
  this with -TeamName/-Coaches/-Players/-OutDir.

  Safe to re-run for a NEW player added to -Players — it will only touch files for
  players still listed. It will NOT touch a player's report or the team summary once
  you've started filling in real data there, because at that point you should edit
  those files directly instead of re-running this.

.PARAMETER TeamName
  e.g. "Bethlehem Boom 10U"

.PARAMETER Coaches
  String array of coach names.

.PARAMETER Players
  Array of hashtables: @{ Number = 1; Name = "Maggie M"; Slug = "maggie_m" }

.PARAMETER OutDir
  Path, relative to reports/, to write this team's files into. Use "." for the reports/
  root (only Bethlehem Boom uses this, to preserve its already-shared live URL); every
  other team should use its own slug, e.g. "latham-lady-bison-white-10u".
#>
param(
    [Parameter(Mandatory = $true)][string]$TeamName,
    [Parameter(Mandatory = $true)][string[]]$Coaches,
    [Parameter(Mandatory = $true)][array]$Players,
    [Parameter(Mandatory = $true)][string]$OutDir
)

$reportsRoot = Join-Path $PSScriptRoot "..\reports"
$outPath = Join-Path $reportsRoot $OutDir
New-Item -ItemType Directory -Force -Path $outPath | Out-Null

# ============================================================
# Individual player pages
# ============================================================
$templatePath = Join-Path $reportsRoot "_individual_report_template.html"
$template = Get-Content $templatePath -Raw

foreach ($p in $Players) {
    $displayName = "$($p.Name) (#$($p.Number))"
    $html = $template

    $html = $html.Replace(
        "TEMPLATE — copy this file per player, rename it, and edit the placeholders below (header text + the GAME_LOG array + the CHECKLIST array + the diagnosis/comps/drills sections near the bottom of the &lt;body&gt;).",
        "AWAITING VIDEO — no at-bats filmed yet for $displayName. Film her at-bats in a game (every AB, not just notable ones), drop the clip(s) in videos/, run scripts/extract_frames.ps1, then fill in this report."
    )

    $html = $html.Replace("BarrelIQ Swing Report — {{PLAYER_NAME}}", "BarrelIQ Swing Report — $displayName")
    $html = $html.Replace("{{PLAYER_NAME}}", $displayName)

    $html = $html.Replace(
@'
    <div class="meta">
      <span><b>Last updated:</b> {{DATE}}</span>
      <span><b>At-bats reviewed:</b> <span id="abCount">0</span></span>
      <span><b>Vantage:</b> {{e.g. behind backstop}}</span>
    </div>
'@,
@"
    <div class="meta">
      <span><b>Team:</b> $TeamName</span>
      <span><b>Jersey:</b> #$($p.Number)</span>
      <span><b>Last updated:</b> Awaiting video</span>
      <span><b>At-bats reviewed:</b> <span id="abCount">0</span></span>
      <span><b>Vantage:</b> —</span>
    </div>
"@
    )

    $html = $html.Replace(
@'
        <div class="issue-card">
          <b>Issue:</b> {{e.g. "Steps in the bucket — front foot opens toward third base before the swing starts"}}<br>
          <b>Seen in at-bats:</b> {{e.g. "AB 1 vs Eagles (8/2), AB 2 vs Hawks (8/9)" — cite specific rows from the Game Log above}}<br>
          <b>Likely cause:</b> {{e.g. fear of the ball / no weight transfer practice}}<br>
          <b>Effect on outcomes:</b> {{e.g. pulls off outside pitches, rolls over to weak grounders}}
        </div>
        <!-- copy this .issue-card block again for a 2nd/3rd issue if needed -->
'@,
        "        <p>No at-bats have been filmed yet for $displayName. Once games are logged and frames are extracted, fill in the specific issues here.</p>"
    )

    $html = $html.Replace(
@'
        <table class="comp-table">
          <tbody>
            <tr><td>{{e.g. Sierra Romero (softball)}}</td><td>{{lets the ball travel deep before releasing the barrel — good for a hitter rushing/lunging at the ball}}</td></tr>
            <tr><td>{{e.g. Ichiro Suzuki}}</td><td>{{hands stay inside the ball, short direct path — good for a caster}}</td></tr>
            <tr><td>{{e.g. Ted Williams}}</td><td>{{slight upward bat path to match the pitch's downward plane — good for a chopper}}</td></tr>
          </tbody>
        </table>
'@,
        "        <p>Comp cues will be picked once the specific issue is identified from film — see the reference bank below for the menu of options.</p>"
    )

    $html = $html.Replace(
@'
        <ul class="drills">
          <li><b>{{Drill 1}}</b> — {{targets Issue 1}}</li>
          <li><b>{{Drill 2}}</b> — {{targets Issue 2, if applicable}}</li>
        </ul>
'@,
        "        <p>Drills will be recommended once the primary issue(s) are identified from film.</p>"
    )

    $html = $html.Replace(
@'
          <div><b>Re-film by</b>{{date}}</div>
          <div><b>What to check next time</b>{{specific checkpoint(s) from section 1}}</div>
'@,
@'
          <div><b>Re-film by</b>TBD — awaiting first clip</div>
          <div><b>What to check next time</b>Full checklist (section 1)</div>
'@
    )

    $playerOutPath = Join-Path $outPath "$($p.Slug).html"
    Set-Content -Path $playerOutPath -Value $html -NoNewline
    Write-Host "Wrote $playerOutPath"
}

# ============================================================
# Team summary
# ============================================================
$teamTemplatePath = Join-Path $reportsRoot "_team_comparison_template.html"
$teamHtml = Get-Content $teamTemplatePath -Raw
$sorted = $Players | Sort-Object Number
$coachesStr = $Coaches -join ", "

$teamHtml = $teamHtml.Replace("BarrelIQ Team Overview — {{TEAM_NAME}}", "BarrelIQ Team Overview — $TeamName")

$teamHtml = $teamHtml.Replace(
    "TEMPLATE — copy this file, rename it, and edit the PLAYERS array near the bottom of the &lt;body&gt; (one object per player, scores 1-3 in the same checkpoint order as CHECKPOINTS). Report links should point at each player's individual report .html file.",
    "AWAITING VIDEO — no game at-bats filmed yet for this roster. As games get filmed, fill in each player's Game Log + checklist scores in her individual report (linked below) and this page updates automatically."
)

$teamHtml = $teamHtml.Replace(
@'
    <div class="meta">
      <span><b>Coaches:</b> {{coach names, comma separated}}</span>
      <span><b>Purpose:</b> Quick side-by-side for coaches/parents. Full detail lives in each player's individual report.</span>
    </div>
'@,
@"
    <div class="meta">
      <span><b>Coaches:</b> $coachesStr</span>
      <span><b>Purpose:</b> Quick side-by-side for coaches/parents. Full detail lives in each player's individual report.</span>
    </div>
"@
)

# Roster list
$rosterLines = ($sorted | ForEach-Object { "      <li><b>#$($_.Number)</b> $($_.Name)</li>" }) -join "`n"
$teamHtml = $teamHtml.Replace(
@'
      <li><b>#{{N}}</b> {{Player 1 name}}</li>
      <li><b>#{{N}}</b> {{Player 2 name}}</li>
'@,
    $rosterLines
)

# Side-by-side summary rows
$summaryRows = ($Players | ForEach-Object {
@"
          <tr>
            <td class="player-name">#$($_.Number) $($_.Name)</td>
            <td class="wrap-cell">Awaiting video</td>
            <td class="wrap-cell">Awaiting video</td>
            <td class="wrap-cell">Awaiting video</td>
            <td class="wrap-cell">Awaiting video</td>
            <td><a class="report-link" href="$($_.Slug).html">View report →</a></td>
          </tr>
"@
}) -join "`n"
$teamHtml = $teamHtml.Replace(
@'
          <tr>
            <td class="player-name">#{{N}} {{Player 1 name}}</td>
            <td class="wrap-cell">{{biggest strength}}</td>
            <td class="wrap-cell">{{primary issue}}</td>
            <td class="wrap-cell">{{fix focus / drill}}</td>
            <td class="wrap-cell">{{comp cue}}</td>
            <td><span class="report-link disabled">No report yet</span><div class="review-rollup none" title="0 of 11 scored checkpoints are coach-confirmed; the rest are still AI-drafted">0/11 confirmed</div></td>
          </tr>
          <tr>
            <td class="player-name">#{{N}} {{Player 2 name}}</td>
            <td class="wrap-cell">{{biggest strength}}</td>
            <td class="wrap-cell">{{primary issue}}</td>
            <td class="wrap-cell">{{fix focus / drill}}</td>
            <td class="wrap-cell">{{comp cue}}</td>
            <td><span class="report-link disabled">No report yet</span><div class="review-rollup none" title="0 of 11 scored checkpoints are coach-confirmed; the rest are still AI-drafted">0/11 confirmed</div></td>
          </tr>
'@,
    $summaryRows
)

# Heat map body (all pending pills — 11 checkpoints)
$pendingPill = '<span class="pill pending" title="Awaiting video">–</span>'
$pendingCells = (1..11 | ForEach-Object { "<td>$pendingPill</td>" }) -join ""
$heatRows = ($Players | ForEach-Object {
    "          <tr><td class=`"player-name`">#$($_.Number) $($_.Name)</td>$pendingCells</tr>"
}) -join "`n"
$teamHtml = $teamHtml.Replace(
@'
          <tr><td class="player-name">{{Player 1 name}}</td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td></tr>
          <tr><td class="player-name">{{Player 2 name}}</td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td><td><span class="pill" data-score="2" title="Developing">2</span></td></tr>
'@,
    $heatRows
)

# Heat map team-avg row (all pending — no scores yet)
$pendingAvgCells = (1..11 | ForEach-Object { '<td><span class="pill pending avg" title="Awaiting video">–</span></td>' }) -join ""
$teamHtml = $teamHtml.Replace(
    '<tr class="avg-row"><td>Team avg</td><td><span class="pill avg" data-score="2" title="Developing">2.0</span></td><td><span class="pill avg" data-score="2" title="Developing">2.0</span></td><td><span class="pill avg" data-score="2" title="Developing">2.0</span></td><td><span class="pill avg" data-score="2" title="Developing">2.0</span></td><td><span class="pill avg" data-score="2" title="Developing">2.0</span></td><td><span class="pill avg" data-score="2" title="Developing">2.0</span></td><td><span class="pill avg" data-score="2" title="Developing">2.0</span></td><td><span class="pill avg" data-score="2" title="Developing">2.0</span></td><td><span class="pill avg" data-score="2" title="Developing">2.0</span></td><td><span class="pill avg" data-score="2" title="Developing">2.0</span></td><td><span class="pill avg" data-score="2" title="Developing">2.0</span></td></tr>',
    "<tr class=`"avg-row`"><td>Team avg</td>$pendingAvgCells</tr>"
)

# Detected-patterns default (no scores yet -> matches the "anyScored=false" JS branch text)
$teamHtml = $teamHtml.Replace(
    "<li>No shared weak points detected among the players currently shown — team averages are all at or above 2.0.</li>",
    "<li>No scores entered yet — once a few players are scored, shared weak points will show up here automatically.</li>"
)

# Coach notes placeholder
$teamHtml = $teamHtml.Replace(
@'
      <li>{{e.g. "3 of 8 players open their front foot early — worth a team station on this at next practice"}}</li>
      <li>{{another observed pattern}}</li>
'@,
    "      <li>No notes yet.</li>"
)

# Individual report links
$linksLines = ($sorted | ForEach-Object { "          <li><a class=`"report-link`" href=`"$($_.Slug).html`">#$($_.Number) $($_.Name)</a></li>" }) -join "`n"
$teamHtml = $teamHtml.Replace(
@'
          <li>#{{N}} {{Player 1 name}} <span class="hint">(no individual report file yet)</span></li>
          <li>#{{N}} {{Player 2 name}} <span class="hint">(no individual report file yet)</span></li>
'@,
    $linksLines
)

# JS PLAYERS array
$jsPlayers = ($Players | ForEach-Object {
    "    { number: $($_.Number), name: `"$($_.Name)`", strength: `"Awaiting video`", issue: `"Awaiting video`", drill: `"Awaiting video`", comp: `"Awaiting video`", report: `"$($_.Slug).html`", scores: [null,null,null,null,null,null,null,null,null,null,null], reviewedCount: 0 },"
}) -join "`n"
$teamHtml = $teamHtml.Replace(
@'
    {
      number: "{{N}}",
      name: "{{Player 1 name}}",
      strength: "{{biggest strength}}",
      issue: "{{primary issue}}",
      drill: "{{fix focus / drill}}",
      comp: "{{comp cue}}",
      report: null,
      scores: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      reviewedCount: 0,
    },
    {
      number: "{{N}}",
      name: "{{Player 2 name}}",
      strength: "{{biggest strength}}",
      issue: "{{primary issue}}",
      drill: "{{fix focus / drill}}",
      comp: "{{comp cue}}",
      report: null,
      scores: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      reviewedCount: 0,
    },
    // copy/paste another object per additional player
'@,
    $jsPlayers
)

$teamOutPath = Join-Path $outPath "team_summary.html"
Set-Content -Path $teamOutPath -Value $teamHtml -NoNewline
Write-Host "Wrote $teamOutPath"

Write-Host "`nDone. $($Players.Count) player report(s) + team_summary.html generated for $TeamName in $outPath."
