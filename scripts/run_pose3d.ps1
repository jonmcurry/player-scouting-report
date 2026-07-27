<#
.SYNOPSIS
  Runs the production pose/bat/3D-lift analysis pipeline on one swing clip.

.DESCRIPTION
  Replacement for the MediaPipe-only prototype (pose_analyze.py). Detects the
  batter + bat, tracks both through the clip, lifts to 3D, computes coaching
  metrics (bat speed, attack angle, hip-shoulder separation at contact, lead
  elbow angle at contact, stride), and renders an annotated overlay for QA.
  See scripts/pose3d/README.md for the full stack rationale and setup.

.PARAMETER VideoPath
  Path to the source video (mp4/mov) in the videos/ folder.

.PARAMETER PlayerName
  Player name/slug - same convention as extract_frames.ps1. Output goes to
  frames/<PlayerName>/<clipName>/ (clipName = video's own filename stem).

.PARAMETER LegacyMediapipe
  Run the old pure-MediaPipe prototype (pose_analyze.py) instead, using the
  MAIN python environment (not .venv_pose3d) - kept available per the spec's
  "keep old code behind a flag, not default" requirement. Writes to
  scripts/pose_out/ in that script's own format, not this pipeline's JSON
  contract.

.EXAMPLE
  ./scripts/run_pose3d.ps1 -VideoPath "videos/Emily_C_AB1 (4).mp4" -PlayerName emily_c
  # writes to frames/emily_c/Emily_C_AB1 (4)/{pose_2d,bat_path,pose_3d,metrics}.json, overlay.mp4
#>
param(
    [Parameter(Mandatory = $true)][string]$VideoPath,
    [Parameter(Mandatory = $true)][string]$PlayerName,
    [switch]$LegacyMediapipe
)

if (-not (Test-Path $VideoPath)) {
    Write-Error "Video not found: $VideoPath"
    exit 1
}

$clipName = [System.IO.Path]::GetFileNameWithoutExtension($VideoPath)
$outDir = Join-Path "frames" (Join-Path $PlayerName $clipName)
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if ($LegacyMediapipe) {
    Write-Host "Running legacy MediaPipe-only prototype (main env)..."
    python scripts/pose_analyze.py $VideoPath "scripts/pose_out"
    exit $LASTEXITCODE
}

$venvPython = ".venv_pose3d/Scripts/python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Error "Missing $venvPython - see scripts/pose3d/README.md to set up the isolated venv first."
    exit 1
}

& $venvPython "scripts/pose3d/run_pipeline.py" $VideoPath $outDir
exit $LASTEXITCODE
