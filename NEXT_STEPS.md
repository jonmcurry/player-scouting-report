## Prioritized outstanding work from `docs/SIMPLIFIED_APP_SPEC.md` (updated 2026-10-06)

This is the current work order. **Critical** items block inviting families or a hosted release;
**High** items block a spec-complete simplified default route; **Medium** items close
validation and operating gaps; **Low** items are explicitly deferred or small cleanup. The dated
entries below retain the evidence and history behind these tasks. Jon's manual visual review of
the earlier Android build passed; the final AGY visual pass could not authenticate or reach its
browser service.

### Critical — release and child-privacy gates

- [ ] **Finish consent and publication rules (§2, §3.6, §9).** Get Jon's approval of guardian
  consent wording; implement re-consent when the version changes; keep public-demo permission
  separate for coach and guardian uploads; resolve the current mismatch between consent wording
  and publication of coach-uploaded footage of linked children. Keep the implemented pre-selection
  disclosure that visible children's names go to Gemini and verify provider handling. Complete a
  release privacy review.
  - [x] Locally implement the version-mismatch access gate, linked-guardian renewal RPC, and
    named re-consent screen. Unknown consent text versions fail closed; the current text and
    stored version were not changed.
  - [x] Gate local public-demo export of every selected clip when the child has linked guardians,
    including coach uploads: the curation manifest must record separate permission from each
    currently linked guardian. A failed link lookup blocks export, and guardian IDs remain out
    of the public fixture. Guardian-upload permission remains a separate requirement.
  - [ ] Run the multi-child consent path on the parent browser. The Windows integration suite now
    passes stale, renewed, revoked, and two-linked-child isolation cases, including immediate
    loss of only the removed child's access. Obtain approval of any new wording before
    bumping its stored version. Verify the new publication gate against real linked-player data and review
    the actual permission records before any public-demo export. The full read-only Gemini privacy
    review found no blocking issue. A final narrow review of malformed-link handling also found
    no blocking issue; its empty-list concern is covered by the service-role loader throwing on
    query errors. Repeat the full review before release.
    Decide release policy for coach-created links when a child's guardian consent becomes stale;
    the local creator-access gates below do not require every linked guardian's current consent.
  - [x] Gate simplified share reads on the creator's current player access. A guardian-created
    token now fails while consent is stale or the link is removed, and cannot revive after renewal
    or re-invitation because its issue time predates the new consent time. Coach-created tokens
    follow current team access. All failures return the same 404 as an invalid token.
  - [x] Gate legacy public report and signed-video reads on the creating coach's current team
    access. Removing the coach's access now closes that coach's outstanding legacy links; the
    frozen demo's separate report function remains unchanged.
  - [x] Run the new stale-consent, renewal, revoke, re-invite, and coach-access-removal share-token
    integration case for simplified and legacy links on the Windows Supabase stack. All cases pass
    with the creator-access behavior documented above. Review whether
    coach-created links should depend on every guardian's current consent before release.
- [ ] **Prove access and deletion in the hosted release environment (§2, §8, §10).** Local guardian,
  legacy media/report, deletion, and demo-schema/fixture checks pass. Repeat them against the hosted
  release environment and verify the coach's allowed access and each linked, unrelated, and revoked
  guardian's exact allow/deny
  rules for reports, progress, videos, and deletion. Explicitly prove that guardians cannot list,
  read, or infer the team roster or other players. Verify coach removal of a parent link and parent
  self-unlink end access immediately; verify each shared token exposes only its intended report.
  Route every remaining legacy clip, at-bat, rep, and player-removal path through audited storage
  deletion so no raw video is orphaned. The full local guardian suite passes; hosted verification
  remains open.
  On macOS, the integration stack is unavailable: Supabase and the GCS emulator run only on
  Jon's Windows machine. Windows verification now passes the full guardian and real-fixture demo
  suites. Keep hosted access and deletion verification visible until it is run against the release
  environment.
  - [x] Update old integration fixtures to opaque raw paths, assert insert-time rejection of
    invalid paths, and check shared reports for internal IDs. Normalize uppercase upload
    extensions before storage reservation. Local unit and static checks pass.
  - [x] Run the full guardian and demo-fixture integration suites on Windows. The guardian suite
    passes 65/65 and covers coach, linked/revoked/unrelated guardian, anonymous, multi-child, notification, and shared-link
    boundaries plus audited deletion. The real-fixture demo suite passes 15/15. Migration 00049
    upgrades pre-00047 stored fixtures in memory without changing their payloads or hashes.
  - [x] Audit the legacy coach removal paths. Single-clip, whole-at-bat, practice-rep, and player
    removal all call the shared `delete-clip` helper before deleting their owning database rows;
    regression coverage now fails if one of those paths returns to a row-only media delete. The
    direct clip-table delete is limited to the media-free local demo clone.
- [ ] **Complete the report's evidence behavior and validate it on real footage (§1, §3.3, §5, §10).**
  Verify the prompt's plain-language summary and evidence-backed strengths. Then run at least 20 real phone and GameChanger at-bats through the
  new report; record unreadable and fix rates, and get Jon's judgment on every shown fix. Reach
  the spec's ≥80% agreement target or tighten the threshold. Verify outcome-unknown and
  strength/phase semantic checks, exclude `swing_decision`, `pitch_location_adjustment`, and
  `game_approach` from both shown fixes and Progress, and enforce the rule that every displayed
  claim traces to its source video and stored run.
  - [x] Store and render separate `readable`, `confirmed_no_swing`, and `inconclusive` detector
    states. Only an explicit high-confidence pipeline signal can confirm no swing; missing phases,
    detector errors, Walk/Strikeout, and every other result chip fail closed as inconclusive.
    Confirmed no-swing stays in the feed and cannot increment readable-game Progress. Local API,
    database, UI, guardian, and demo-fixture tests pass. The current pipeline does not yet emit a
    high-confidence no-swing signal, so real-footage calibration remains part of the 20-clip gate.
    **MANUAL VISUAL QA REQUIRED:** AGY reached the local app in a real browser, but demo mode routes
    to the classic view and normal mode requires an authenticated fixture, so it could not render
    the new no-swing report. No Android emulator was running for deployment.
  - [x] Use only the newest analysis run for each clip in report, feed, practice, and Progress.
    A newer run with incomplete report evidence now withholds the older claim; it also cannot count
    as a clean game swing or become the Progress comparison video. Feedback on an older run no
    longer hides a newer run's report or feed headline. The shared read guard also rejects a
    strength with an unrecognized phase. The real-token Windows integration case passes for missing summaries,
    malformed phases, and old feedback; verify re-analysis during
    the 20-clip footage review.
  - [x] Recheck local prompt and semantic guards: the prompt asks for plain parent language and
    video-grounded strengths, unknown outcomes cannot be asserted as facts, and strengths require
    text, visible evidence, and a supplied swing phase. The focused semantic suite passes 42/42. The existing
    focus selector excludes the three unsupported pitch-context concepts from One fix and Progress.
    This is code/test verification, not the required judgment on 20 real at-bats.
  - [x] Reject blank One fix observation, evidence, cue, or next-check text during AI output
    validation. At read time, a current-run finding with incomplete copy now makes the report and
    feed unreadable and cannot count toward persisted game Progress or practice evidence. Focused
    local validation and the expanded malformed-issue Windows integration case pass.
- [ ] **Complete the replacement family journey before inviting families (§3–4, §10–11).** Run the
  full authenticated coach → invite → guardian consent → upload → report → share loop on Android
  and a parent browser, including the parent switcher for two linked children, offline
  capture/upload queue and retry across app restarts, accessible 48 px targets, one-hand layout,
  and the approved prototype's behavior. Make the simplified routes default only after that loop
  passes; remove verified-unused legacy Group B UI without breaking the frozen demo or rollback.
  - [x] Make the replacement Home the local default for signed-in coaches and guardians. Coaches
    retain the explicit `?legacy=1` rollback route; guardians retain `family.html` for invite,
    re-consent, unlink, and legacy rollback work, and otherwise continue into the replacement app.
    Static route tests pass. This does not substitute for the authenticated device/browser loop.
  - [ ] Complete the authenticated Android and parent-browser loop and rendered comparison before
    inviting families. Only then remove the verified-unused legacy UI; until then the explicit
    rollback route remains intentional.
- [ ] **Finish persisted Progress behavior (§3.4, §5.5–5.6).** Test stored focus transitions after
  real feedback and deletion evidence, make the app read persisted focus status, and verify the
  Progress state and current drill shown to families. Notification triggering depends on these
  transitions, so this must pass before the first family invite.
  - [x] Make the simplified report use `player_focus` for the current concept, status, start date,
    and history. Recent game swings now check the stored status before the API makes a progress
    claim; mismatches show a temporary checking state, and incomplete or deleted evidence shows
    Early read. A stored fixed focus shows Looks fixed only while four intact clean game swings
    still support it. Focused local tests cover pending writes, stale status, deletion gaps, and
    fixed history.
  - [x] Run persisted transitions through the Windows Supabase stack with isolated readable-game
    fixtures and the real feedback/deletion Edge Functions. Three repeated video-supported findings
    create the stored focus; later clean evidence persists Improving; deleting a sequence member
    makes the API return Early read without erasing the historical focus or claiming Looks fixed.
    The full guardian suite passes 65/65.
  - [ ] Repeat the transition check with real readable game footage, then inspect the authenticated
    parent Progress screen and current drill. Native push/email delivery remains part of the
    hosting/provider work in §7. The Mac does not have the local Supabase/GCS stack.
  - [x] Add the provider-independent notification trigger and privacy boundary. Report-ready,
    uploader-only failure, and Improving/Looks fixed transitions enqueue service-only, idempotent
    one-player events. Recipients are resolved at delivery time from current coach/guardian access,
    consent, and the user's preference; focus notices are limited to one per rolling seven days per
    player. Pure delivery assembly batches report events per recipient and player, never across
    children. The Windows integration suite proves clients cannot list or manufacture events and
    verifies revocation/opt-out behavior. Push/email providers and device tokens remain open.
- [ ] **Complete drill safety curation and rendered shared-link review (§3.3, §3.5, §5.4).** Audit every
  currently emittable drill for age, sport, equipment, and screen/adult-feeder safety. Keep
  unapproved or safety-flagged candidates out of the app; a fix with no suitable drill must show
  "No drill for this yet." Verify that missing player and team ages use the under-13 safety tier.
  Verify the share-link API payload and rendered page expose only the player's first name plus last
  initial and no team name.
  - [x] Show "No drill for this yet" on Progress when a stored focus has no eligible drill; the
    report already used that fallback. The existing selector excludes missing `best_for`, wrong
    sport or age, weighted/overspeed drills for under-13s, and every screen-required drill. Unknown
    age defaults to 12 in both report and Progress reads. These rules do not replace human curation.
  - [x] Audit the migration-seeded library: all seven production seeds predate `best_for`, and
    migration 00047 leaves that field null. The selector therefore emits none of those seeds on
    a freshly migrated database. Actual live rows, manual edits, and the 90 research candidates
    still require the human safety and content review below.
  - [x] Project simplified shared report and Progress payloads to display fields, removing explicit
    player, clip, issue, and drill ID fields. Apply the same identity scrub to free-text focus
    concepts and keep the first-name/last-initial redaction. Local projection tests pass; the
    real shared-token integration case passes on the Windows stack. Signed media URLs still use opaque
    object paths.
  - [x] New simplified share URLs contain only the bearer token. The report API resolves its
    player and report clip from that token; older links with player/clip query parameters continue
    to work only when those values match the token. Focused local page checks, Edge Function
    bundling, and the expanded real-token Windows integration case pass.
  - [ ] Review every currently active, human-approved drill and the actual parent screen on the
    Windows stack. Inspect the rendered shared page and signed media URLs.
- [ ] **Complete the launch infrastructure and migration gate (§3.5, §7, §9–11).** Verify real
  GCS upload, signed playback, deletion, CORS, and storage permissions; copy and verify old named
  objects to opaque paths before any parent-facing video or share link uses them. Validate and
  apply hosted migrations 00041–00051, deploy the Edge bundle, host Supabase and a GPU worker,
  check the pre-deploy `unrecognized_demo_fixture_count()` predicate before the first hosted
  clip deletion, measure processing time and cost, and prepare rollback. Migration 00051 and the
  worker hooks now provide the service-only notification outbox, delivery-time recipient lookup,
  weekly focus throttle, and per-player batching boundary. Add native push, email fallback,
  device-token handling, event claiming/retry, and provider delivery; then prove the provider output
  on a real multi-player bulk upload. Deployment and rollback actions require Jon's release
  authorization.

### High — core spec still incomplete

- [ ] **Curate the drill library (§3.3, §5.4, Phase 2).** Have a human approve or reject candidates,
  specific “Best for” wording, concept, sport, minimum age, equipment, and screen/adult-feeder
  safety. Import only approved entries; verify every shown fix has suitable choices where curated
  content exists and that no drill text is invented or unsafe for the player's age.
- [x] **Finish the available GameChanger roster import implementation and verification (§3.6).**
  CSV, screenshot, and paste all end in editable review; duplicate matching/re-import behavior,
  coach-only access, reordered/extra-column CSV parsing, stat exclusion, immediate source-input
  clearing, bounded screenshot output, and fallback paths have automated coverage.
  - [x] Clear the chosen CSV from the browser file input immediately after local parsing, even
    when parsing fails or the file is too large. The parsed rows remain in memory only until the
    coach maps identity columns; no stats are sent to Supabase.
  - [x] Add coach-only screenshot extraction with a disclosure shown before file selection. The
    browser accepts bounded JPG, PNG, and WebP images, sends them transiently to a protected Gemini
    Edge Function, immediately clears the file input, highlights uncertain rows, and always requires
    editable coach review before import. Neither the image nor non-identity text is written to
    HitterLoop storage or logs; CSV and paste remain available after failure. Provider handling and
    the corresponding guardian-consent wording still require review before release.
  - [x] Record the evidence limit instead of retaining an impossible test gate: Jon cannot provide
    a real GameChanger CSV export or roster screenshot. Actual provider headers and screenshot
    extraction therefore remain unverified, must not be described as validated, and are protected
    by explicit mapping/edit review plus CSV/paste fallbacks. Revisit only if representative data
    becomes available; it no longer blocks completion of the local simplified-app implementation.

### Medium — validation and operating readiness

- [ ] **Close remaining reliability checks (§9–10).** Measure ≤10-minute processing for a
  ≤60-second clip and daily upload and clip-length caps. Review allowed upload content types and
  signed URL rendering.
  - [x] Verify the shared 10-upload rolling daily reservation cap applies to coaches and guardians,
    and retain the simplified UI's three-minute metadata check before a file enters the offline
    queue. Browser and Edge code now share an MP4/M4V/MOV/WebM extension/MIME allowlist; unsupported
    or conflicting types cannot reserve a signed destination. Local GCS upload and signed playback
    paths remain covered by the guardian integration suite.
  - [x] Enforce the three-minute cap in the upload worker before pose or AI processing so a non-app
    client cannot bypass it. Over-limit clips fail terminally without consuming automatic retries,
    and the parent report shows a plain duration-limit explanation.
  - [ ] Measure a real ≤60-second phone clip and GameChanger clip on the target GPU, and verify
    signed upload/playback plus CORS against real GCS rather than the emulator.
- [x] **Align project documentation with the new product contract (§12).** The README and repository
  agent contract now describe automatic, fail-closed reports, optional feedback, current simplified
  routes, player-scoped family access, and the legacy workflow's temporary rollback role. Phase B
  self-coached parents remain explicitly deferred.

### Low — after the first release or small follow-ups

- [ ] **Plan later data cleanup (§4, §8, Phase 6).** After roughly four weeks of real use, audit
  callers and real data, then separately review removal of historical checklist, priority,
  pitch, comparison, and other obsolete tables. Do not drop them during the additive first release.
- [ ] **Revisit deferred product choices (§13).** Parents without a team, billing, analyzing every
  swing in a multi-swing clip, and native iOS can wait for usage evidence. Malformed delete IDs
  returning 403 is a small error-response follow-up recorded in the 0.33.0 entry below.

## 2026-10-06: 0.39.0 roster screenshot extraction, simplified default, and notification boundary

- Added the remaining local GameChanger import option: an acknowledged, coach-only screenshot is
  sent transiently to the configured Gemini model and converted into bounded identity candidates.
  The image is not stored or logged, no database write occurs before the existing review action,
  and uncertain or incomplete rows are highlighted. CSV and pasted-list paths remain available.
  Actual provider data handling and consent wording remain release gates; no real child roster was
  sent during this work. Real GameChanger screenshot/export validation is unavailable and is
  recorded below as an accepted evidence limitation rather than an open implementation task.
- The Windows guardian suite now passes 65/65, including stale consent, renewal, revoke/re-invite,
  creator access removal for simplified and legacy share links, malformed newest-run evidence,
  audited deletion, and exact two-child guardian isolation without roster access. The real-fixture
  suite passes 15/15. The earlier test run exposed and then fixed two test-fixture defects: a missing
  required jersey number and reuse of an arbitrary link whose creator could correctly be revoked.
- A new database-and-Edge integration case proves persisted Progress transitions: repeated readable
  game evidence creates a focus, later clean evidence moves it to Improving, and deleting a serial
  in the evidence window makes the report fail closed to Early read without inventing Looks fixed.
  This used isolated synthetic fixtures; real footage, the rendered parent screen, and drill
  content remain open.
- The replacement app is now the local default after coach or guardian sign-in. The classic coach
  workflow remains available through `?legacy=1`, and the family route remains the consent,
  invite, unlink, and rollback boundary. Authenticated device/browser visual verification remains
  open, so the old UI has not been removed.
- Migration 00051 adds a service-only notification outbox and current-recipient resolver. The
  analysis worker now queues per-player report-ready and uploader-only failure events, while
  persisted Progress queues Improving/Looks fixed events no more than once per rolling week.
  Delivery assembly batches per recipient/player and cannot mix children. No push/email provider,
  device token, or hosted event worker was added or deployed.
- Because no real GameChanger export or roster screenshot will be available, the import item is
  closed at the testable boundary: synthetic reordered/extra-column CSVs, source clearing,
  duplicate review, coach scope, bounded screenshot extraction, mandatory editing, and fallbacks
  are covered. Actual GameChanger headers and extraction quality remain explicitly unverified.
- The simplified app remains a local preview. Hosted privacy/access verification, guardian wording
  approval, real-footage calibration, live drill curation, authenticated rendered QA, real GCS/GPU
  timing, notification-provider delivery, and release/deployment authorization remain open.
  No hosted service, cloud data, or public fixture was changed.
- Final validation passes 228/228 standard tests, 65/65 guardian/privacy integration cases, and
  15/15 real-fixture cases. The Edge runtime bundled all functions, including screenshot extraction.
  The final required read-only Gemini review found no BLOCKING, NON-BLOCKING, or QUESTION / JUDGMENT
  CALL defect in notification privacy, migration safety, default routing, GameChanger safeguards,
  or the documentation claims. AGY rendered QA could not authenticate or reach its browser service,
  and no Android emulator was connected, so **MANUAL VISUAL QA REQUIRED** for the authenticated
  simplified route, family redirect, and import sheet.

## 2026-10-06: 0.38.0 token-only simplified share links

- New share URLs omit player and clip IDs. The existing bearer token now supplies those IDs at the
  report read boundary, while old links remain readable only when their explicit IDs match the
  token's player and scope. Shared response payloads remain display-only. The local page wiring
  checks and Edge Function type check pass. Shared viewers also stay on their report if they tap
  the brand label instead of being sent to coach sign-in. The expanded real-token integration case
  cannot run on this Mac; use the Windows Supabase/GCS stack before inviting families or releasing
  this path. The final read-only Gemini review found no blocking defect.
- Critical release gates above remain open: consent wording and policy, hosted access/deletion,
  real-footage evidence review, authenticated parent/Android flow, live drill audit, migration and
  storage verification, and notification delivery. CSV selection now clears after local parsing;
  missing stored finding copy fails closed across simplified reads. The full local suite passes
  221/221; the report Edge Function type-checks. The final read-only Gemini review found no
  blocking, non-blocking, or judgment findings. Windows integration and authenticated rendered
  QA remain open. No hosted services or fixtures were changed.

## 2026-10-05: 0.37.0 persisted Progress read path

- The simplified API now presents stored focus transitions and checks each status against recent
  readable game evidence. Pending writes show Checking; deletion gaps withhold improvement; a
  stored fixed focus needs four intact clean swings before its Looks fixed sentence appears.
  Focused tests pass 4/4, the project test command and Edge Function type check pass, and the
  completed read-only Gemini review found no blocking or non-blocking defects. Parent/browser
  visual QA and Windows integration with real persisted focus rows remain open. No Android emulator
  was available on this Mac.
- Progress now names the missing-drill state. Simplified share responses are projected to
  display-only fields; a shared report refresh still uses the clip ID from its URL locally.
  The new real-token integration case is pending on Windows. Standalone Deno checking of the
  guardian suite remains blocked by pre-existing `.js` import and fixture slug type errors;
  the report Edge Function itself type-checks. The completed Gemini review found no confirmed
  blocking defect. Its hypothetical feed scope and shared delete button are absent from the
  current code. A later privacy challenge led to explicit focus field projection and an injected
  private-note test; the final review accepted that fix. The report fix also uses explicit fields
  and a null guard, and an exception in text redaction returns the endpoint's generic 500 response.
  Authenticated rendered QA is still required.
- The report, home feed, practice evidence, and both Progress read/write paths no longer skip a
  newer run with incomplete report evidence. Such a run blocks stale text and focus evidence from
  an older run for the same clip. Older feedback no longer suppresses a newer run's report or feed.
  The read paths now share the report evidence check. Gemini's adversarial review identified the
  old-feedback and malformed-strengths cases; those were corrected locally. Windows re-analysis
  integration and real-footage review remain open.
- Read-time evidence validation now rejects an unrecognized strength phase. A Windows integration
  case has been added for incomplete re-analysis, malformed phase evidence, and superseded hidden
  feedback; it cannot run on this Mac. The seven production seed drills remain ineligible until
  a human supplies approved `best_for` text; live library contents still need auditing.
- Simplified share tokens now check their creator's current access before serving child data.
  Guardian-created tokens stop at stale consent or unlink and do not revive after renewal or
  re-invitation; coach-created tokens follow team access. The Windows integration case is pending.
  Whether a coach-created or legacy link should also depend on every guardian's current consent
  remains a release policy decision.
- Legacy public report links and their signed-video reads now require the creating coach's current
  team access. The isolated Windows integration case covers access removal; the frozen demo uses
  a separate function and is unaffected.

## 2026-10-05: 0.36.0 documentation and upload reliability

- Current product documentation now matches the approved simplified contract: direct fail-closed
  reports, optional feedback instead of approval, player-scoped guardian access, retained legacy
  rollback routes, and self-coached parents deferred. The repository test command passes 219 of
  220 backend tests with one environment skip plus all 219 coach/browser checks.
- The existing rolling daily reservation cap covers both coaches and guardians, and simplified
  capture rejects clips over three minutes before queueing. Browser and Edge upload paths now share
  one allowlist for MP4, M4V, MOV, and WebM, including extension/MIME consistency. The local Edge,
  Supabase, and GCS integration suite passes 59/59. The worker also probes each downloaded video
  before pose or AI work and terminally rejects clips over three minutes without retrying them.
  Target-GPU timing and real GCS/CORS verification remain open.

## 2026-10-05: 0.35.0 Windows integration, demo parity, and no-swing state

- The local Windows stack now has migrations 00048–00050 and passes all 58 guardian integration
  cases, including re-consent, cross-role access, upload reservation, deletion retry, shared-link
  privacy, and GCS emulator behavior. The real-fixture demo pipeline passes all 15 export, import,
  clone, isolation, rollback, and frontend-query cases. The standard command passes 216 of 217
  backend tests with one environment skip plus all 214 coach/browser checks. No hosted schema,
  media, or canonical fixture changed.
- Pre-00047 stored demo fixtures receive missing simplified-schema defaults only while cloning;
  their stored payload and hash stay intact. New exports explicitly omit the frozen demo's new
  runtime and simplified-report fields instead of leaking private feedback or unsupported state.
- The legacy coach clip, whole-at-bat, practice-rep, and player-removal paths all call the audited
  deletion helper before removing their owning rows. Static regression coverage protects those
  call sites; the broader Critical access/deletion item remains open for hosted verification.
- Pipeline completion now persists a separate swing-detection state. A readable phase can produce
  a report; only a future explicit high-confidence detector result can produce the no-swing report;
  every other no-phase result remains inconclusive. This prevents Walk or Strikeout labels from
  manufacturing a take while preserving confirmed no-swing at-bats in the feed.

## 2026-10-04: 0.33.0 focus evidence follow-up — simplified app is not ready to release

- Progress now uses the persistent game-swing serial counter to detect deleted clips in its latest
  five and four-swing proof windows. Hidden findings for the current concept also block an
  improvement claim. A complete, clean last four can still support "Looks fixed." The focus
  transition is now persisted by the server when a report fix is hidden or a clip deletion begins;
  the worker also excludes deletion-pending clips from its stored-focus refresh. Jon passed the
  updated emulator visual review. The independent code review completed after correcting its
  first pass's misreading of the four-clean-swing rule. With Jon's explicit AGY authorization,
  the visual wrapper ran but its headless browser command permission was denied; it produced no
  visual findings. The new feedback/deletion path still needs authenticated cross-role testing.
  Notification delivery remains open. The Edge Functions are local only. The guardian suite now
  reads the local consent setting instead of assuming v1; that exposed a pre-existing upload URL
  UUID check that rejected valid IDs, now fixed. A targeted guardian upload authorization test
  passes. After a local-only backup, the recorded-but-missing 00046 schema changes were applied
  transactionally to the local QA database. The last full guardian run passed 39/54 cases; 15
  failed, mostly because test fixtures still create legacy video paths rejected by the 00046 trigger.
  Four isolated integration cases pass together for consent mismatch, guardian upload scope,
  coach and linked-guardian feedback and deletion, refusal of an unrelated coach, and absence of a
  deletion audit row after refusal. Evidence-driven status transitions still need an end-to-end
  fixture. Gemini found no blocking issue in the new path; its hypothetical retry concern is
  answered by the existing `hide_simple_issue` early return for an already-hidden issue. It noted
  the pre-existing caller-supplied upload content type and malformed delete IDs returning 403 as
  non-blocking follow-ups.
  The stored demo fixture lacks 00047's new player counter, and older media/report assertions also
  need reconciliation before the cross-role check is complete. No hosted setting was changed.

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
  layout and authenticated coach/guardian flows. The local default now uses the replacement route
  with an explicit legacy rollback; only after the rendered flows pass should the obsolete Group B
  UI files identified in `docs/simplified_questions.md` be removed.
- [x] Complete the available GameChanger import verification. Screenshot extraction has a clear
  pre-selection Gemini notice and mandatory review, with CSV/paste fallback. Real provider
  screenshots/exports are unavailable, so actual headers and extraction quality remain unverified.
- [ ] Curate and approve drill candidates, including age and screen/feeder safety fields, before
  activating them. Confirm selected cards match the fix and do not invent instructions.
- [ ] Complete authenticated focus feedback/deletion verification and notification delivery.
  Re-consent now fails closed locally; get approval for any replacement consent wording and
  keep separate public-demo permission for coach and guardian uploads.
- [ ] Validate real GCS upload/playback/delete, old-object copy-and-verify migration, 20 real at-bat
  reports, and end-to-end parent access. The complete Edge Function bundle now starts locally and
  the local schema smoke test was rolled back; hosted migrations 00041–00047, storage migration,
  hosting, and deployment are pending.
- [ ] Perform manual rendered visual QA (the final AGY run could not authenticate or reach its browser service) and the
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

Semantic validation note from the superseded `todo.md` handoff:
- The old known-pitch-zone and database-derived pitch-context checks are retired because the
  simplified app no longer collects or presents pitch location, pitch type, or count.
- Body-position uses of inside, outside, high, and low remain part of the Critical report-evidence
  validation above so they are not mistaken for unsupported pitch-location claims.

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
