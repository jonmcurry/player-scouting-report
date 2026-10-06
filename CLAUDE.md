# CLAUDE.md

Project-specific instructions for Claude Code sessions in this repo. These are scoped to four
things: changelog discipline, versioning, git commit/push conventions, and emulator deployment. For
everything else (architecture, conventions, who the user is) rely on the auto-memory system and
NEXT_STEPS.md, not this file — keep this file narrow rather than letting it become a second,
competing source of truth.

## Changelog

This project keeps `CHANGELOG.md` at the repo root, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):
reverse-chronological version headers, each with `Added` / `Changed` / `Fixed` / `Removed`
subsections as needed (omit empty ones).

- **`CHANGELOG.md` vs `NEXT_STEPS.md` — different jobs, don't conflate them.** `NEXT_STEPS.md` is
  the working/in-progress doc: open todos, honest narrative of what was tried and why, stuff that
  gets pruned once resolved. `CHANGELOG.md` is the durable, concise, per-version record of what
  actually shipped — short bullets, no narrative, never pruned. A real fix earns a `NEXT_STEPS.md`
  entry while it's being worked through; it earns a `CHANGELOG.md` line once it's done and the
  version bumps.
- Update `CHANGELOG.md` whenever you bump the version (see below) — add the new version's section
  with bullets summarizing what actually changed, written for someone who wasn't in the session.
- Don't backfill history predating when this practice started (2026-08-01) — `CHANGELOG.md` starts
  from here forward, it doesn't try to reconstruct every past session from `NEXT_STEPS.md`.

## Versioning

Semantic versioning (`MAJOR.MINOR.PATCH`), tracked in `package.json` (root), `mobile/package.json`,
and mirrored in `mobile/android/app/build.gradle`'s `versionName` (bump `versionCode` by 1 any time
`versionName` changes — required by Android regardless of how the APK is distributed). Keep all
three in sync; don't bump one without the others.

Since the product is pre-1.0, treat this pragmatically rather than by strict library-semver rules:

- **PATCH** (`0.1.x`): bug fixes, small UI tweaks, non-behavioral refactors.
- **MINOR** (`0.x.0`): a real new capability or behavior change a user/coach would notice — a new
  upload type, a pipeline fix that changes real output, a new report section. Most normal work
  session output lands here.
- **MAJOR** (`x.0.0`): reserved for genuinely large shifts — a schema change that isn't backward
  compatible, a real product pivot (e.g. if the batting-lesson question in `NEXT_STEPS.md` turns
  into dropping game-at-bat support), or the actual 1.0 ship. Don't reach for this casually.

Known gap as of 2026-08-01: `mobile/android/app/build.gradle`'s `versionName` (`1.0`) had already
drifted from the npm packages' `0.1.0` before this policy existed. Don't silently "fix" version
drift you find — flag it to the user, since deciding what the real current version should be is a
product call, not a mechanical one.

## Git commit/push

Commit message conventions specific to this repo (in addition to the general git safety rules
already in your system instructions — those still apply in full, including **never commit or push
without the user explicitly asking each time**, which this project does not override):

- This repo's history favors **one commit per work session's accumulated output**, not one commit
  per tiny change — see `git log` for real examples (a title line plus a body of short paragraphs
  focused on *why*, with real specifics: what was verified, real numbers, what broke and how it was
  found). Match that style rather than defaulting to a generic one-line message.
- **Never stage `.claude/settings.json`** as part of a feature commit unless the user specifically
  asked to change permissions. It accumulates session-specific tool-approval entries as a side
  effect of normal tool use (confirmed real during the 2026-08-01 session: dozens of ultra-specific
  one-off `Bash`/`PowerShell` patterns from a single debugging session) — that's local noise, not
  project change. Check `git diff .claude/settings.json` before including it in `git add`.
- Push to `origin master` only — this is a public repo
  (`jonmcurry/player-scouting-report`), and there's no other branch convention in use.

## Emulator deployment

After finishing a change to the coach app (`coach/`, `mobile/`) — not mid-edit, but once it's ready
to be looked at — rebuild and install the latest build onto the Android emulator, if one is already
running, without waiting to be asked:

```powershell
cd mobile && npx cap sync android
cd android && .\gradlew.bat assembleDebug
& "C:\Android\platform-tools\adb.exe" -s emulator-5554 install -r app\build\outputs\apk\debug\app-debug.apk
& "C:\Android\platform-tools\adb.exe" -s emulator-5554 shell am start -n com.hitterloop.coach/.MainActivity
```

- `npx cap run android` does not reliably work in this Windows/Git Bash setup (a `gradlew` spawn
  resolution issue) — drive `gradlew.bat` + `adb install` directly instead, per the pattern above,
  not `cap run`.
- Only do this if an emulator is already running (`adb devices` shows a `device`, not empty) — don't
  boot one just to deploy to it.
- Real SDK path on this machine is `C:\Android` (`mobile/android/local.properties`'s `sdk.dir`), not
  the more typical `%LOCALAPPDATA%\Android\Sdk` — confirm before assuming platform-tools/emulator
  live somewhere else.
- Skip this for changes that don't touch `coach/`/`mobile/` (e.g. the Python pose3d pipeline, root
  CLI scripts, database migrations with no frontend change) — there's nothing new to deploy.


<!-- BEGIN HITTERLOOP MULTI-AGENT MANAGED BLOCK -->
## Multi-agent orchestration

### Authority

- User is the final product, design, evidence, privacy, release, and deployment authority.
- Claude Code is the sole orchestrator and implementation agent.
- Gemini is the independent review and visual/product QA agent.
- Tests, source evidence, repository state, and rendered behavior outrank model opinion or model consensus.

### Claude Code responsibilities

Claude owns:
- understanding the requested task
- inspecting repository state before edits
- implementation
- test selection and execution
- static/code review of its own diff
- coordinating Gemini review when required
- reconciling Gemini findings against source evidence, tests, and product rules
- producing the final implementation/release report

Claude must not treat Gemini output as authoritative by itself.

Before any change:
- inspect `git status`
- inspect relevant existing code and tests
- preserve unrelated user work
- do not reset, clean, revert, overwrite, commit, push, deploy, or change cloud state unless explicitly authorized

### Gemini responsibilities

Gemini is an independent adversarial reviewer.

Use Gemini for:
- rendered UI/visual QA
- product wording review
- evidence/claim consistency review
- privacy review
- regression review
- alternative interpretation of implementation behavior
- identifying unsupported assumptions or invented claims

Gemini should normally be read-only.

Gemini must not:
- modify repository files unless the user explicitly authorizes a separate Gemini implementation task
- commit, push, deploy, or mutate cloud state
- override tests or source evidence
- approve its own prior output as ground truth

### Review workflow

Default workflow:

1. Read the task/spec.
2. Inspect repository state.
3. Claude implements.
4. Claude runs focused tests and relevant broader validation.
5. Claude performs an internal diff review.
6. Run Gemini review through the repository Gemini wrapper.
7. Reconcile Gemini findings:
   - fix confirmed defects
   - reject unsupported findings with evidence
   - surface unresolved judgment calls to the user
8. Re-run tests after material fixes.
9. For UI/rendered changes, run Gemini visual QA when available.
10. Stop for user approval before commit/push/deploy unless explicitly authorized.

### Evidence hierarchy

Use this order when agents disagree:

1. original source data / original video / original artifact
2. repository code and schema
3. deterministic test results
4. rendered runtime behavior
5. documented product rules
6. Claude reasoning
7. Gemini reasoning

Agent agreement does not convert an unsupported claim into evidence.

### Review severity

Gemini findings should be classified as:
- BLOCKING
- NON-BLOCKING
- QUESTION / JUDGMENT CALL

Claude must independently verify blocking findings before changing code.

### Failure behavior

If Gemini is unavailable:
- do not substitute fake multi-agent consensus
- continue only with Claude review/tests when the task is low-risk
- for privacy, evidence integrity, schema, release, or other high-risk work, report that independent review was unavailable and stop if the task requires it

### Release safety

Never commit, push, deploy, reset, change Supabase/cloud state, or publish fixtures unless the user explicitly authorizes that action.

For release tasks:
- preserve rollback
- verify exact staged files
- distinguish local validation from public publication
- fail closed on privacy/consent/media/hash mismatches

## HitterLoop Product Contract

Core loop:

**WATCH → UNDERSTAND → FOCUS → TRAIN → RECHECK**

The original swing video is the source of truth.
The simplified app's approved direction is automatic reports for parents and coaches.
The coach owns the team and can hide a finding that does not look right.

Prioritize:
- what is working;
- what needs attention;
- evidence;
- next development step;
- one fix per readable at-bat;
- vetted drills;
- game and practice kept distinct;
- deterministic progress from repeated game swings.

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
- never invent Drills;
- never invent progress;
- never invent metrics;
- insufficient evidence fails closed;
- automatic reports show only video-supported findings that meet the display threshold;
- a parent or coach can hide a finding that does not look right.

See `docs/SIMPLIFIED_APP_SPEC.md` for the approved target. Existing screens and historical
coach-reviewed data still follow their original behavior until their replacement ships.

## Engineering Safety Rules

Before editing:
- inspect repo and branch;
- inspect git status;
- inspect existing uncommitted diff;
- preserve unrelated user work.

Never unless explicitly authorized:
- git reset --hard;
- discard local changes;
- overwrite user work;
- commit;
- push;
- deploy;
- alter cloud data;
- change canonical fixture pointers.

## Automatic QA Invocation

For any task that modifies repository files, Claude must automatically run the repository
orchestrated QA workflow before reporting the task complete.

Do not wait for the user to ask for QA separately.

### Required sequence

1. Complete the implementation.
2. Run the relevant focused tests.
3. Run broader validation appropriate to the files changed.
4. Perform an internal review of the current diff.
5. Automatically invoke:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Invoke-OrchestratedQA.ps1 `
  -ReviewPrompt "<task-specific review prompt>"
```

6. Gemini independently reviews the current repository state and diff.
7. Claude reconciles Gemini findings against:
   - source evidence;
   - repository code and schema;
   - deterministic tests;
   - rendered runtime behavior;
   - documented product rules.
8. Fix findings that Claude confirms from evidence.
9. Do not make a change merely because Gemini suggested it.
10. Re-run affected tests after any material fix.
11. If a material fix changes behavior Gemini already reviewed, re-run Gemini review.
12. Do not report the task complete until:
   - relevant tests and QA pass; or
   - unresolved findings are explicitly surfaced to the user.

Claude must never claim Gemini or multi-agent review occurred if the wrapper did not actually
complete successfully.

### Task-specific Gemini review prompt

The `-ReviewPrompt` must be specific to the task that was actually performed.

Do not blindly send the same generic prompt on every task.

Ask Gemini to focus on the risks relevant to the current change, such as:
- correctness;
- regressions;
- unsupported assumptions;
- evidence integrity;
- missing-data handling;
- privacy;
- publication/consent;
- schema implications;
- UI behavior;
- release safety.

Example:

```text
Review the current diff for the at-bat summary changes.

Focus on:
- whether unknown swing/take data becomes a fabricated fact;
- whether analyzed video is mislabeled as an analyzed swing;
- whether failed queries create false claims;
- whether unsupported text can be persisted;
- regressions in existing at-bat behavior.

Classify findings as BLOCKING, NON-BLOCKING, or QUESTION / JUDGMENT CALL.
```

### Frontend / visual QA

For frontend work affecting `coach/`, `mobile/`, public demo rendering, or other user-visible
behavior, perform rendered/visual QA in addition to the code review when meaningful.

Use the existing Gemini/AGY visual QA path where appropriate.

If browser automation or usable rendered evidence is unavailable, report:

**MANUAL VISUAL QA REQUIRED**

Do not fabricate a visual QA pass.

### High-risk work

Gemini independent review is required before completion for:
- privacy or consent changes;
- public fixture publication;
- evidence/claim logic;
- schema or migration changes;
- AI analysis semantics;
- canonical fixture changes;
- release/deployment workflows;
- media/hash/publication handling.

If Gemini is unavailable for high-risk work:
- do not fake independent review;
- stop before commit/release/deployment approval;
- explicitly report that independent review is unavailable.

### Low-risk work

For clearly low-risk work such as:
- typo-only changes;
- comments;
- documentation-only edits;
- trivial non-behavioral cleanup;

Claude may continue without Gemini if Gemini is unavailable, but must explicitly say that the
Gemini review did not complete.

## Review Gates

### Orchestrated QA gate

For any repository-modifying task, run automatically:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Invoke-OrchestratedQA.ps1 `
  -ReviewPrompt "<task-specific review prompt>"
```

This replaces the old Codex review gate.

### Visual QA gate

For frontend work requiring rendered inspection, use the existing Gemini/AGY visual QA workflow.

If the repo still provides:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Invoke-AgyVisualQA.ps1
```

it may be used for the rendered visual pass in addition to `Invoke-OrchestratedQA.ps1`.

If browser automation is unavailable, report:

**MANUAL VISUAL QA REQUIRED**

## Final Handoff

Before asking for release approval, provide:
- files changed;
- behavior changed;
- tests run and results;
- Gemini review result;
- AGY/Gemini visual QA result when applicable;
- any BLOCKING findings;
- any NON-BLOCKING findings;
- any QUESTION / JUDGMENT CALL items;
- known limitations;
- git status;
- anything still unverified.

Do not include a Codex review result.

Do not commit, push, deploy, modify cloud data, or publish fixtures unless explicitly authorized by
the user.
<!-- END HITTERLOOP MULTI-AGENT MANAGED BLOCK -->

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
