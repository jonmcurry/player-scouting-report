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
