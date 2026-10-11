# Analysis depth Phase 3: attempt and context transition

Phase 3 adds migration 00057 after the uncommitted local Phase 1/2 migrations 00055–00056. It does not change the existing family report, focus, progress, sharing, demo fixture, or clip deletion read path. No migration or fixture was deployed or published in this session.

## Canonical legacy rule

- `public.resolve_legacy_swing_attempt(clip_id, create)` is the only resolver. A clip must be ready with stored `swing_detection_state = 'readable'`. A result chip, unknown state, or confirmed no-swing never creates an attempt.
- The database permits one canonical attempt at index 0 per legacy clip. The original clip and its canonical attempt represent one swing, never two. The constraint deliberately prevents multiple attempts per clip until deletion, demo, share, reprocessing, and consumer migrations are verified in a later phase.
- If reprocessing later downgrades a clip to no-swing or inconclusive, its derived row remains audit history but disappears from the service-only active-attempt view and resolver; it contributes zero current swings.
- `public.record_legacy_attempt_snapshot` is the one service-side dual-write boundary. The upload worker calls it only after the original clip is marked ready, and failure of this advanced write cannot fail a family upload. Repeating the same source revision is idempotent; a changed pipeline snapshot appends new phase events.
- Run `npm run backfill-swing-attempts` to inspect eligible clips without writing. Add `-- --apply` only after local verification and approval for the target database. Existing clip reads remain the rollback path; derived attempt data does not need to be discarded.
- Set `ANALYSIS_ATTEMPT_PARITY=1` in a local worker to compare its stored canonical attempt and phase snapshot with the legacy clip/event projection. The flag does not move a report or focus consumer.

## Context and phase truth

- Initial sport comes from the team; only a game log proves `game` environment. Practice subtype and attempt intent remain `unknown`. No-swing is not silently relabeled a take.
- Reprocessing appends a classified context revision if the source team sport or game/practice setting changed. A later coach correction remains authoritative and is never overwritten by that classifier.
- Phase snapshots keep legacy stance/load/stride/follow-through labels where the existing detector does not justify more specific biomechanical events. Pipeline and detector versions are recorded when supplied; missing versions, frame/time, and uncertainty stay unavailable. Existing high/low confidence does not become a fabricated numeric uncertainty.
- Authorized coach corrections append complete context or phase records with actor and reason. The original machine snapshot stays intact. Service-side methodology eligibility always reads the newest context revision, so a new slap/bunt/take/protective intent cannot retain a stale conventional-only eligibility decision.
- Unknown intent only passes a validated definition if that definition explicitly includes `unknown` and every concrete intent; an unknown sport or a required but unknown environment remains unavailable.
- The attempt, context, and phase tables are service-only with RLS. Coach correction RPCs check team access and pending deletion. New optional evidence-package attempt links must match the package's original clip. Clip deletion cascades attempt data.

## Verification still needed before release

- Start local Supabase with migrations through 00057 and run `npm run test:swing-attempts`, `npm run test:capture-assessment`, and `npm run test:analysis-evidence`.
- Run backfill dry-run, then apply to a disposable local fixture. Reprocess representative softball/baseball clips and compare the legacy family report/focus shape with the flagged attempt parity result. Include a no-swing and inconclusive clip.
- Validate context and phase corrections against original video before any advanced observation or measurement uses them. No Phase 4 coach-analysis UI or new family claim was introduced.
