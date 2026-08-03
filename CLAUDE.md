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
& "C:\Android\platform-tools\adb.exe" -s emulator-5554 shell am start -n com.barreliq.coach/.MainActivity
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
