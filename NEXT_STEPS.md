## 2026-10-04: 0.32.1 filming guide follow-up — simplified app is not ready to release

- The preview now shows an illustrated filming guide on first use and from Settings or an unreadable
  report. The Record sheet's camera direction matches the approved behind-home-plate guidance.
  Android sync now excludes the local browser demo override from generated APK assets. Jon reported
  the emulator manual review looked good; authenticated coach and guardian flows and full prototype
  comparison still need verification before release.

## 2026-10-04: 0.32.0 follow-up todo — simplified app is not ready to release

- The preview now has settings, a visible contact marker and contact jump, contact-aligned
  comparison playback, a current-focus drill, and a practice evidence line. These still need
  authenticated coach/guardian browser checks and manual rendered review. Notifications are a
  saved preference only; delivery remains a hosting phase task. The legacy routes remain default.
- Local build and focused practice/report/focus tests pass. The full in-process test run had one
  existing local-schema failure (`teams.age_group` is absent from the running local database),
  and normal Node test isolation is permission-blocked. After Jon authorized transfer of the
  current diff/source, the Gemini code-review wrapper completed. It found no blocking issue in
  practice counting or shared-link redaction. The confirmed dialog-label gap and one-way video
  synchronization were fixed and need re-review. Gemini raised a judgment call about the existing
  strict `requires_screen` drill exclusion; keep it fail-closed until drill safety curation decides
  how supervised drills can be shown. Offline settings caching is outside the approved offline
  capture requirement. A second Gemini pass confirmed the dialog and playback fixes, then surfaced
  a multi-word surname redaction gap. A later Gemini pass confirmed case-insensitive replacement
  could corrupt ordinary coaching words; a case-sensitive alternative could leak lowercase names.
  The current local fix withholds ambiguous shared prose instead. Final Gemini re-review found no
  blocking defect; an unaccented full name may withhold the entire shared field, and a singularized
  word from a plural team name remains a low-risk naming edge case. Rendered visual QA remains open.

- [ ] Verify the replacement screen against the approved prototype, including accessible mobile
  layout. Run authenticated coach and guardian browser flows, then switch the default routes. Only after
  those routes work, remove the obsolete Group B UI files identified in `docs/simplified_questions.md`.
- [ ] Add GameChanger screenshot import with a clear notice before sending children's names to
  Gemini. Keep CSV/paste as the fallback, and verify import mapping with a real GameChanger export.
- [ ] Curate and approve drill candidates, including age and screen/feeder safety fields, before
  activating them. Confirm selected cards match the fix and do not invent instructions.
- [ ] Complete the confirmed-no-swing state, focus persistence after feedback/deletion, notification
  delivery and settings, and the guardian re-consent gate. Get approval for the consent v2 draft;
  keep separate public-demo permission for coach and guardian uploads.
- [ ] Validate the Edge Function bundle, real GCS upload/playback/delete, old-object copy-and-verify
  migration, 20 real at-bat reports, and end-to-end parent access. The local schema smoke test was
  rolled back; hosted migrations 00041–00047, storage migration, hosting, and deployment are pending.
- [ ] Perform manual rendered visual QA (the AGY headless browser was permission-blocked) and the
  release privacy review. Do not invite families or enable the new default route before these pass.

## 2026-10-03: simplified app refactor in progress (0.31.0)

- Privacy groundwork is local only: anonymous share reports redact player identity and team;
  new uploads use opaque object paths; playback refuses old paths until the separate copy-and-
  verify migration runs; coach and family deletes use the audited `delete-clip` route. Migration
  00046 and the storage copy script have not been applied to any cloud project.
- GameChanger CSV import now offers explicit column mapping and player review, because the
  published export instructions do not include stable column headers. A real export remains
  unavailable; screenshot OCR is still open. CSV statistics stay in browser memory and are not
  sent to the database.
- Cleanup removed verified orphaned report rendering and static skeleton publication scripts,
  an obsolete setup script, a committed backup, and the superseded handoff after carrying its
  semantic-validation follow-ups here. The MediaPipe fallback and research provenance remain.
- Pure report assembly, focus transitions, drill filtering, an authenticated/share-token read
  endpoint, and additive schema foundations are in the working tree. A first replacement Home,
  Record, Report, and Progress UI exists at `coach/simple.html`, including a persistent IndexedDB
  upload queue and an invite-parent action, but it has not been switched into the default routes or
  rendered end to end. The classic coach review UI is still the default. Do not invite families on
  this build. Drill curation, screenshot import, notifications, hosting, and the 20 real at-bat check
  remain open. The new report and focus UI still needs polish against the approved prototype.
- The 00036–00047 migration chain and `supabase/tests/simplifiedFoundations.smoke.sql` passed in a
  local Postgres transaction that was rolled back; no hosted schema was changed. The SQL fixture
  covers coach and guardian capture/share permissions and a same-owner upload resume reservation.
  Local `npm test` (211), focused analysis/development tests (57), roster tests (3), and Deno path
  tests pass. Upload retries now reuse both a reserved storage object and an idempotent at-bat row.
  The current Edge Function bundle and a real GCS upload remain unverified. Gemini review found
  pending-deletion feed recovery and multi-video at-bat deletion defects; both were fixed and
  re-reviewed. Its final warning that nullable drill instructions could crash shared reports is
  contradicted by the existing `drill_library.instructions not null` and new
  `common_mistakes text[] not null` schema; its path-prefix concern is guarded by
  `begin_clip_deletion`. Historical hidden findings still conservatively mask a reanalysis
  summary because sentence-to-finding attribution is unavailable. The browser visual pass is open:
  the AGY headless wrapper could not obtain browser command permission.
- Guardian consent has a draft in `docs/review/guardian-consent-v2-draft.md`; it needs a re-consent gate before any version change or
  release. Explicit guardian permission for public use remains separate. Prepare rollback only
  when an actual release is authorized.
- The old 2026-10-02 items below remain historical context; the privacy bypass and false consent
  statements there are being addressed here and should be reconciled after validation.

- The Codex/Gemini orchestrated QA wrapper ran successfully for this refactor; its visual wrapper
  could not access a browser in headless mode.

Semantic validation follow-ups carried from the superseded `todo.md` handoff:
- Check that a known pitch zone cannot be described as an unknown location.
- Exercise database-derived game pitch context and practice repetition context in `buildAnalysisInput`.
- Add wording cases where inside, outside, high, or low describe body position rather than pitch location.

## 2026-10-02: parent pathway (0.30.0, uncommitted)

Open items:
- **Consent text v1 awaits user approval** (`consentText()` in `coach/components/familyPage.js`; version `guardian-consent-2026-10-01` in `app_settings`).
- **Publication wording - user decision.** Consent v1 says videos "are never published publicly without my separate written permission", which covers coach uploads of the child too. The demo exporter only refuses *guardian* uploads without publication permission; coach uploads of a linked child are not gated. Either gate coach uploads of any child with a linked parent, or narrow the consent wording, before release.
- **Re-consent is not built - required before any consent version bump after release.** `is_guardian_for_player()` and `family.html` must compare `player_guardians.consent_version` with `current_guardian_consent_version()` and prompt re-acceptance; today a linked parent keeps access under the version they accepted. Fine while there are no real guardians and v1 is unapproved.
- **Known limitation: most coach deletes bypass `delete-clip`.** Only "Delete Pitch" in the player page's game log goes through it. The game-log entry (at-bat) delete in `player.html`, the rep delete in `practicePage.js`, the player delete, and a direct `video_clips` delete under RLS all remove rows only: raw videos stay in GCS (orphaned), no `clip_deletions` audit row, worker frames stay, and the demo-fixture refusal is skipped. `src/cli/reconcileUploads.ts` finds orphaned objects (manual run). Rerouting them is a separate refactor.
- **Phase B (self-coached parents) not started;** the gating decision is open.
- **PRE-DEPLOY checklist** (nothing is deployed):
  - Apply migrations 00041-00045 to hosted (public + demo where they apply) before shipping this coach build (the Review queue selects `uploaded_by_role`; Manage player calls `revoke_guardian_invites`).
  - Before 00043: run the unrecognized-demo-fixture predicate (the `where not (...)` of `unrecognized_demo_fixture_count()` in 00043) against hosted `demo.demo_real_fixtures`. Any row it counts blocks every clip delete until reviewed.
  - Add the app `index.html` URL to hosted Auth allowed redirect URLs (parent sign-up email confirmation returns there).
  - `deno check` every changed Edge Function (`get-family-report`, `delete-clip`, `get-upload-url`, `get-video-url`, `get-player-report`, `_shared/`) and do a deploy dry-run: `_shared/familyReport.ts` imports `../get-player-report/shape.ts` across function directories, and bundling of that is unverified (Deno isn't installed locally).
  - Confirm the Edge Functions' service account has `storage.objects.delete` (delete-clip) and `storage.objects.get` (get-upload-url's existence check).
  - Real GCS: guardian upload URLs are signed with `x-goog-if-generation-match: 0` and the browser sends that header, so the bucket's CORS config must allow it as a request header (`responseHeader`). Unverified against real GCS; the emulator path (`ifGenerationMatch=0`) is tested.
  - The upload worker must run 0.30.0: it purges deleted clips' local files and finishes deletions stuck for over 15 minutes.
- **Tests:** `npm run test:guardians` (`node --import tsx --test supabase/tests/guardians.test.ts`) needs the local stack, `npx supabase functions serve --env-file .env` and the GCS emulator; it is not part of `npm test`.
- **Deferred minors:**
  - `guardian_register_clip` doesn't pin the bucket in `p_raw_gcs_path` (any `gs://<bucket>/` prefix passes; low impact).
  - `delete-clip` classifies errors by message substring, not SQLSTATE.
  - Unlink's 409 "try again" copy loops on a permanent hold (e.g. a clip in a published demo).
  - Invite expiry shown to the coach is computed client-side (mirrors the 7-day default).
  - `listRow` ignores `ariaLabel` (the queue's ", from family" label is dead).
  - Family upload defaults to "Game".
  - Family page "Latest progress check" shows an ISO date.
  - No cap/rate limit on outstanding invites.

## 2026-10-01: demo data + UX pass (0.27.0-0.29.0, uncommitted)

Open items:
- **Coach review of the new AI drafts (blocks a real Priority in the demo).** Local re-analysis of 8 Emily clips (Claude Opus, batter-zoomed stills + swing sequences) produced 33 checkpoint drafts and 0 findings. Drafts for checkpoints already coach-reviewed are not written to `checklist_scores`; they are in `frames/emily/*/phase_stills/analysis_result_*.json` and the local packet `frames/coach-review-2026-10-01/index.html` (unmasked minor - never publish). Notable: hand path Developing on 3/5 swings, bat path 2/4, head/eyes 2/5, load 3/4. Only the coach can turn these into a Priority/Drill.
- **Game1 clips that failed honestly:** `emily_c_ab1_3` (contact not locatable), `emily_c_g2_ab2` (bat never detected, camera too far down the baseline). Marked `failed` locally.
- **Phase detection on 30fps side-on Game1 clips** fires contact early (the swing is often in the "extension" frame). The swing-sequence window now runs to the last located phase as a workaround; the detector itself is unchanged.
- **Review markers are misaligned for Stage-0-trimmed uploads in the coach app** (offset 0 in `devUi.js` `videoTimeFor`); the AI-still side is fixed by `analysisWindow.ts`, the UI side needs the window start stored per clip (schema change).
- **Demo export drops `swing_phases.detail`** (`scrubDerivedEvidence`), so "Zoom on player" won't appear on the public demo until the exporter passes `subject_box` through (needs a privacy decision: it is position-only geometry).
- **Live-site console errors** (Google Fonts, Cloudflare beacon) should be gone with the 0.29.0 service-worker change; unverified until deployed.
- Pre-existing: `checklistReview.js` and `playerDevelopmentSummary.js` are not in `sw.js` ASSETS (offline shell); `package-lock.json`/`mobile/package-lock.json` versions still say 0.18.2.
