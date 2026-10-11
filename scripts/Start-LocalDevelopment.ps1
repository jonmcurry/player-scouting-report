[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required for the local Supabase and GCS services."
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "Node.js and npm are required for the local processing worker."
}

Write-Host "Checking local Supabase..."
& npx --no-install supabase status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Starting local Supabase..."
  & npx supabase start
  if ($LASTEXITCODE -ne 0) { throw "Local Supabase did not start." }
}

Write-Host "Starting the local video store..."
& docker compose up -d gcs-cors-proxy
if ($LASTEXITCODE -ne 0) { throw "The local GCS emulator did not start." }

$posePython = if ($IsWindows) {
  Join-Path $repoRoot ".venv_pose3d/Scripts/python.exe"
} else {
  Join-Path $repoRoot ".venv_pose3d/bin/python"
}
if (-not (Test-Path -LiteralPath $posePython)) {
  throw "Pose3D environment not found at $posePython. Follow scripts/pose3d/README.md first."
}

$env:POSE3D_PYTHON = $posePython
Write-Host "Local services are ready. Starting the automatic upload worker; press Ctrl-C to stop."
& npm run process-upload-queue
exit $LASTEXITCODE
