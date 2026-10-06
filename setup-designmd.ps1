#requires -Version 7.0
<#
.SYNOPSIS
  Sets up Google's DESIGN.md format for a repo and wires it into Codex,
  Gemini/Antigravity (agy), and Claude project instructions.

.DESCRIPTION
  Safe to run repeatedly. By default this script:
    1. Creates DESIGN.md if it does not already exist.
    2. Adds/updates a managed DESIGN.md instruction block in AGENTS.md.
    3. Adds/updates the same block in CLAUDE.md if present (or creates it).
    4. Adds/updates GEMINI.md for Gemini/Antigravity compatibility.
    5. Installs @google/design.md as a dev dependency when package.json + npm exist.
    6. Lints DESIGN.md using the cross-platform "designmd" binary.

  Existing instruction-file content is preserved. Only the block between
  DESIGN-MD-AUTO markers is managed by this script.

.EXAMPLE
  pwsh ./setup-designmd.ps1

.EXAMPLE
  pwsh ./setup-designmd.ps1 -ProjectPath ~/code/my-app

.EXAMPLE
  pwsh ./setup-designmd.ps1 -SkipNpmInstall -SkipLint
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$ProjectPath = ".",

    [switch]$SkipNpmInstall,
    [switch]$SkipLint,
    [switch]$NoClaude,
    [switch]$NoGemini,

    # Replaces an existing DESIGN.md with the starter template.
    # A timestamped backup is created first.
    [switch]$ForceDesign
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "    OK: $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "    WARN: $Message" -ForegroundColor Yellow
}

function Get-Utf8NoBom {
    return [System.Text.UTF8Encoding]::new($false)
}

function Write-TextFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Content
    )
    [System.IO.File]::WriteAllText($Path, $Content, (Get-Utf8NoBom))
}

function Upsert-ManagedBlock {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Block
    )

    $start = "<!-- DESIGN-MD-AUTO:START -->"
    $end   = "<!-- DESIGN-MD-AUTO:END -->"

    if (Test-Path -LiteralPath $Path) {
        $content = [System.IO.File]::ReadAllText($Path)
    } else {
        $content = ""
    }

    # Remove the previous managed block, if one exists.
    $pattern = "(?s)\r?\n?$([regex]::Escape($start)).*?$([regex]::Escape($end))\r?\n?"
    $content = [regex]::Replace($content, $pattern, "")
    $content = $content.TrimEnd()

    if ($content.Length -gt 0) {
        $content += [Environment]::NewLine + [Environment]::NewLine
    }

    $content += $Block.Trim() + [Environment]::NewLine
    Write-TextFile -Path $Path -Content $content
}

$designTemplate = @'
---
name: Your Product

colors:
  primary: "#1A1C1E"
  accent: "#2F6FED"
  surface: "#FFFFFF"
  muted: "#6C7278"

typography:
  h1:
    fontFamily: Inter
    fontSize: 2rem
    fontWeight: 600
  body:
    fontFamily: Inter
    fontSize: 1rem
    lineHeight: 1.5

rounded:
  sm: 4px
  md: 8px

spacing:
  sm: 8px
  md: 16px
  lg: 32px
---

# DESIGN.md

Read this before writing any UI. Every line here should affect what you build.

## Overview

- Calm, coherent, product-specific UI.
- Content first; decoration second.
- Prefer one clear primary action per screen.
- Preserve established product patterns instead of inventing new ones.

## Colors

- Use design tokens only. Do not introduce arbitrary hex values inside components.
- `accent` is reserved for primary actions and links.
- Text/background combinations must meet WCAG AA contrast.

## Typography

- Use the defined font family and type scale.
- Prefer weights 400 and 600 unless the existing product requires otherwise.
- Body text is 1rem.
- Avoid body text smaller than 0.875rem.

## Layout

- Use the spacing scale. Avoid one-off spacing values.
- Build mobile-first around 375px.
- Verify desktop layouts around 1440px.
- Preserve the application's existing layout conventions.

## Elevation & Depth

- Prefer borders and tonal contrast over shadows.
- Use shadows sparingly and consistently.

## Shapes

- Use `rounded.md` for cards and inputs.
- Use `rounded.sm` for smaller controls and chips.

## Components

- Reuse an existing component before creating a new one.
- Interactive elements need hover, focus, disabled, and loading states.
- Lists and data views should have empty and error states where applicable.
- Prefer the project's existing component library and primitives.

## Do's and Don'ts

- Do compare finished UI against this file before considering the task complete.
- Do preserve a consistent visual language across screens.
- Don't add gradients without an explicit design requirement.
- Don't use emoji as UI icons.
- Don't invent a new color, spacing value, radius, shadow, or type style just to make something "pop".
'@

$agentBlock = @'
<!-- DESIGN-MD-AUTO:START -->
## DESIGN.md UI rules

For any UI, frontend, component, CSS, styling, or visual-design work:

1. Read `DESIGN.md` in full before making changes.
2. Treat `DESIGN.md` as the visual source of truth.
3. Reuse its tokens and the project's existing components before inventing new values or patterns.
4. Do not introduce conflicting colors, typography, spacing, radii, shadows, or component styles.
5. After implementation, compare the result against `DESIGN.md` and fix inconsistencies before finishing.

### Orchestrated / delegated UI work

Codex is the orchestrator for this repository. When delegating frontend or UI work to Gemini, AGY, or another sub-agent:

- Include `DESIGN.md` as authoritative project context.
- Require the delegated agent to follow the existing design tokens, components, and interaction patterns.
- Do not allow delegated agents to invent conflicting visual conventions or silently replace the established design language.
- Ask delegated agents to reuse existing components before creating new ones.
- Review delegated UI output against `DESIGN.md` before accepting, merging, or presenting the work as complete.
- Resolve design inconsistencies at the orchestrator level; Codex remains responsible for final design consistency.
- If a delegated agent identifies a genuine conflict in the existing design system, surface it explicitly rather than allowing the worker to choose a new convention on its own.

If `DESIGN.md` conflicts with an explicit user request, follow the explicit user request and update the design system only when appropriate.
<!-- DESIGN-MD-AUTO:END -->
'@

$geminiBlock = @'
<!-- DESIGN-MD-AUTO:START -->
## DESIGN.md UI rules

Before any UI, frontend, component, CSS, styling, or visual-design work, read `DESIGN.md` in full.

`DESIGN.md` is the visual source of truth for this repository. Reuse its tokens and existing project components instead of inventing new colors, typography, spacing, radii, shadows, or component patterns.

After UI work, review the implementation against `DESIGN.md` and resolve inconsistencies before finishing.
<!-- DESIGN-MD-AUTO:END -->
'@

Write-Step "Resolving project"
$resolvedProject = (Resolve-Path -LiteralPath $ProjectPath).Path
Push-Location $resolvedProject
try {
    Write-Ok "Project: $resolvedProject"

    Write-Step "Setting up DESIGN.md"
    $designPath = Join-Path $resolvedProject "DESIGN.md"

    if ((Test-Path -LiteralPath $designPath) -and -not $ForceDesign) {
        Write-Ok "DESIGN.md already exists; leaving it unchanged."
    } else {
        if ((Test-Path -LiteralPath $designPath) -and $ForceDesign) {
            $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
            $backup = Join-Path $resolvedProject "DESIGN.md.$stamp.bak"
            Copy-Item -LiteralPath $designPath -Destination $backup
            Write-Warn "Backed up existing DESIGN.md to $(Split-Path -Leaf $backup)"
        }

        Write-TextFile -Path $designPath -Content ($designTemplate.Trim() + [Environment]::NewLine)
        Write-Ok "Created DESIGN.md starter template."
    }

    Write-Step "Updating agent instruction files"

    $agentsPath = Join-Path $resolvedProject "AGENTS.md"
    Upsert-ManagedBlock -Path $agentsPath -Block $agentBlock
    Write-Ok "AGENTS.md wired to DESIGN.md (Codex + agents that read AGENTS.md)."

    if (-not $NoGemini) {
        $geminiPath = Join-Path $resolvedProject "GEMINI.md"
        Upsert-ManagedBlock -Path $geminiPath -Block $geminiBlock
        Write-Ok "GEMINI.md wired to DESIGN.md (Gemini/Antigravity compatibility)."
    } else {
        Write-Warn "Skipped GEMINI.md (-NoGemini)."
    }

    if (-not $NoClaude) {
        $claudePath = Join-Path $resolvedProject "CLAUDE.md"
        Upsert-ManagedBlock -Path $claudePath -Block $agentBlock
        Write-Ok "CLAUDE.md wired to DESIGN.md."
    } else {
        Write-Warn "Skipped CLAUDE.md (-NoClaude)."
    }

    Write-Step "Setting up Google DESIGN.md CLI"

    $npm = Get-Command npm -ErrorAction SilentlyContinue
    $npx = Get-Command npx -ErrorAction SilentlyContinue
    $packageJson = Join-Path $resolvedProject "package.json"

    if (-not $SkipNpmInstall) {
        if ($npm -and (Test-Path -LiteralPath $packageJson)) {
            Write-Host "    Installing @google/design.md as a dev dependency..."
            & npm install --save-dev "@google/design.md"
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed with exit code $LASTEXITCODE"
            }
            Write-Ok "@google/design.md installed locally."
        } elseif (-not $npm) {
            Write-Warn "npm is not installed/in PATH; skipped local package installation."
        } else {
            Write-Warn "No package.json found; skipped local package installation. Lint can still run via npx."
        }
    } else {
        Write-Warn "Skipped npm install (-SkipNpmInstall)."
    }

    if (-not $SkipLint) {
        Write-Step "Linting DESIGN.md"

        if ($npx) {
            # Use the dot-free alias because Windows can interpret "design.md"
            # as a Markdown file association instead of an executable.
            & npx -y -p "@google/design.md" designmd lint DESIGN.md
            $lintExit = $LASTEXITCODE

            if ($lintExit -eq 0) {
                Write-Ok "DESIGN.md passed the linter."
            } else {
                Write-Warn "The linter reported issues (exit code $lintExit)."
                Write-Warn "Setup is complete; edit DESIGN.md and rerun:"
                Write-Host '          npx -y -p "@google/design.md" designmd lint DESIGN.md'
            }
        } else {
            Write-Warn "npx is not installed/in PATH; skipped lint."
        }
    } else {
        Write-Warn "Skipped lint (-SkipLint)."
    }

    Write-Step "Done"
    Write-Host "    Created/updated:"
    Write-Host "      - DESIGN.md"
    Write-Host "      - AGENTS.md"
    if (-not $NoGemini) { Write-Host "      - GEMINI.md" }
    if (-not $NoClaude) { Write-Host "      - CLAUDE.md" }
    Write-Host ""
    Write-Host "    Next: customize DESIGN.md so its tokens/rules match this product."
    Write-Host "    Re-run this script anytime; managed instruction blocks are idempotent."
}
finally {
    Pop-Location
}
