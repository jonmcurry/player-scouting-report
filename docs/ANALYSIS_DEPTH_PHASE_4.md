# Analysis depth Phase 4: coach phase report

Phase 4 is a separate authenticated coach view. The development summary remains the landing view; its family, share, demo, one-fix, and focus behavior is unchanged. No Phase 5 fingerprint or trend calculation is included.

## Access and activation

- Migration `00058_coach_phase_report.sql` adds private `coach_analysis_access`. A service operator must record both enablement and training acknowledgement for a coach/team before the Coach analysis action appears. A coach membership alone is insufficient. No browser, guardian, share token, demo visitor, or methodology-admin role can grant access.
- `coach_analysis_available`, `get_coach_analysis`, `get_analysis_evidence`, and note mutations each re-check the active canonical attempt, coach team membership, enablement, and deletion state. The read payload is an explicit allowlist. `get-video-url` independently authorizes each original video and validates its opaque storage path.
- An existing clip needs the Phase 3 canonical backfill before this view can open. There is no client-side attempt fallback.

## Evidence and comparison

- The six legacy phase slots retain their original meaning. Missing times/frames remain unavailable. A coach correction shows its author, reason, and earlier detector marker. Quantified frame uncertainty is shown; otherwise the view says it was not measured.
- A phase card links to its original video instant. Optional filmstrip thumbnails are drawn from the original video only if the media host permits canvas reads; text and time controls remain available otherwise.
- The evidence drawer exposes only the provenance of a displayed, coach-visible result with a currently validated definition and matching sport/intent/environment. It never returns raw media paths, source hashes, prompts, or unpublished numeric values. No technical result is invented for an attempt with none.
- Side-by-side playback is limited to another active attempt for the same player with matching sport, known intent, game/practice and batting environments, camera profile, and orientation. Both capture assessments must support their declared setup, with no later correction awaiting recheck. Both players start from the selected located phase and are kept in time alignment. No numeric delta or baseline is calculated.

## Text notes and privacy

- Text notes are append-only create/delete events. Active notes are labeled coach-authored and guardian-visible; deleting a note appends an audit event. The note table is service-only. A separate consent-checked guardian read exposes only live guardian-visible notes after an analysis run exists; the family summary and share payload remain unchanged.
- The Phase 4 checklist names staff-only controls, but §7.2 PR-4 explicitly defers staff-private annotation storage until organization policy, retention, consent wording, and access tests are approved. The UI explains that staff-only notes are unavailable, and the server rejects that visibility. Voice and overlays are also deferred.

## Validation before release

- Run migrations through 00058 on local Supabase and `npm run test:coach-analysis` with real local credentials.
- Run the Phase 3 backfill on a disposable local fixture, then verify the coach read and the unchanged family report for the same swing. Exercise guardian, outsider, demo, deleted/no-swing, and source-video cases.
- Review phone and wide rendering with real signed video. Confirm thumbnail fallback, seeking, synced playback, source disclosures, screen-reader labels, note creation/deletion, and 48px controls.
- No migration, access grant, app build, fixture, or public page was deployed in this session.
