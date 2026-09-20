# Continuous Knowledge Architecture handoff

Work paused on 2026-09-19 because the macOS machine does not have the local Supabase stack. The migration has **not** been applied or tested against Postgres. Do not treat this branch as production-ready yet.

## Preserve these pre-existing working-tree changes

These were already modified/untracked before this implementation started and may be owner work. Do not revert or overwrite them casually:

- `readme.md` was already modified.
- `NEXT_STEPS.md` was already deleted.
- `docs/CONTINUOUS_KNOWLEDGE_ARCHITECTURE.md` was already untracked.
- `docs/research/` was already untracked.

The architecture document is the controlling specification. The three Gemini research files remain candidate research only.

## Implemented so far (code compiles, database behavior unverified)

- Added `supabase/migrations/00028_continuous_knowledge_foundations.sql`:
  - team/player context columns and allowed-value checks;
  - `analysis_runs` provenance table;
  - `analysis_run_id` on AI output tables;
  - structured issue fields, finding key, `ai_original`, and optional rejection reason;
  - trigger that snapshots original AI fields on the first coach decision;
  - coach-readable/service-role-writable RLS for `analysis_runs`.
- Added explicit prompt/policy/knowledge version constants.
- Reworked the prompt into policy, player/pitch context, knowledge pack, and swing evidence sections.
- Added a shared strict runtime response validator used by Gemini, Claude CLI, and draft files.
- Added `noActionNeeded`, zero-to-two issues, controlled concepts/bases, pitch-context flags, and knowledge claim IDs.
- Removed the hardcoded Gemini model. `GEMINI_MODEL` is required; no fallback is used. The `.env.example` value is `gemini-2.5-flash`, verified against Google's current official model documentation.
- Added `CLAUDE_CLI_MODEL` configuration for the local-only backend.
- Added `pose3d-live-1.0.0` as the live pipeline-owned version and write it into `metrics.json`.
- Added an empty, valid production knowledge set under `knowledge/`; no Gemini claim was promoted.
- Added deterministic knowledge validation/filtering/rendering with sport, youth, size, classification, verification, numeric-evidence, and prompt-control safeguards.
- Excluded stored torso/pelvis tilt from AI evidence and recorded the exclusion in the input manifest.
- Stopped deleting comp notes, comp recommendations, and drill recommendations on rerun; new rows carry `analysis_run_id`.
- Replaced wording dedupe for new findings with `(concept, phase, clip)` identity.
- Added minimal team/player context controls to the coach app.
- Added latest-run display behavior, a coach-facing no-action state, and context-aware priority suppression.

## Verification already completed

These passed on macOS:

```text
npm run build
node --import tsx --test src/services/ai/continuousKnowledge.test.ts
```

Focused test result: 11 passed, 0 failed.

The focused tests cover prompt/context delivery, explicit unknowns, no-action/zero issues, the two-issue cap, malformed schema rejection, emergency context, context-based priority suppression, finding identity, numeric evidence, knowledge filtering, prompt-control neutralization, and tilt exclusion.

`npm test` has **not** been run after these changes.

## First steps on the Windows machine

Use the Windows clone/working tree that has the local Supabase and Docker setup. Preserve real local data: use `db push`, not `db reset`, unless the database is definitely disposable.

```powershell
npm install
npx supabase start
npx supabase migration list
npx supabase db push
npm run build
npm test
```

Before testing a real Gemini call, set an explicit model:

```text
GEMINI_MODEL=gemini-2.5-flash
```

For the local Claude CLI backend only:

```text
AI_ANALYZER=claude-cli
CLAUDE_CLI_MODEL=sonnet
```

Do not silently substitute another model if the configured model fails.

## Database and integration work still required

1. Apply migration 00028 to local Supabase and inspect every constraint, trigger, grant, and RLS policy.
2. Run the full existing integration suite. Update old AI draft fixtures to include the new required response fields; do not loosen the runtime validator to preserve stale fixtures.
3. Add/finish database-backed tests proving:
   - an `analysis_runs` row is created with backend/model/prompt/policy/knowledge/pipeline provenance;
   - player context and structured `at_bat_pitches` availability are in `input_manifest`;
   - malformed AI/draft JSON creates no run and no output rows;
   - `ai_original` is populated before the first approve/edit/reject and is never replaced later;
   - `rejection_reason` remains optional and accepts only the architecture enum;
   - a reworded rejected finding on the same clip/concept/phase is suppressed;
   - the same concept on a different clip can surface as materially new evidence;
   - reruns retain old comp/note/drill rows and attach new rows to the new run;
   - coach-reviewed issue/checklist rows remain untouched;
   - `analysis_runs` is readable only to a coach for that player's team and writable only by service role.
4. Decide whether checklist history is sufficient for the requirement that historical output remain reconstructable. `checklist_scores` is still a current-state upsert table; its `analysis_run_id` changes on an unreviewed rerun. If exact historical checklist drafts are required, add an append-only run-output table rather than breaking the coach UI's unique `(player_id, checkpoint_id)` contract.
5. Verify the `video_clips -> at_bat_pitches(...)` embedded select used by `buildAnalysisInput()` returns the expected PostgREST shape for game and practice clips.
6. Add `pipeline_version` itself to `input_manifest.swing_evidence`; it is already stored in `analysis_runs.pipeline_version`, but the manifest should repeat the exact supplied/unknown state.
7. Consider logging failed model invocations. The current schema records successful validated analyses; a missing/invalid model safely leaves the clip ready but does not create an `analysis_runs` failure row because the specified table has no status/error columns.

## Known code issues to fix before calling this done

1. Existing historical issues receive `suggest_priority=false` from the migration default. The new UI currently hides their Promote button. Preserve existing coach functionality by allowing promotion when `analysis_run_id` is null, while continuing to suppress new `context_explains_it=true` findings.
2. New finding identity works for new structured rows. Historical rejected rows have no honest concept/finding key and must not be backfilled from wording. Document this limitation or design a manual review/backfill path; do not fabricate historical provenance.
3. Confirm `Type.STRING` with `nullable: true` in the installed `@google/genai` response schema works in a real API call. TypeScript compilation passed, but no live Gemini call was made.
4. Confirm `GenerateContentResponse.modelVersion` is populated by this SDK/API path. If absent, keeping `ai_model_version=null` is correct.
5. Review whether source-less manual `--claudeDraft` runs should use `ai_model="claude-draft-file"` or require an explicit model identifier in the draft metadata.
6. Add an explicit unit/integration assertion that `GEMINI_MODEL` missing fails before any database write and never affects clip readiness.
7. Validate the HTML changes with `coach/components/pages.test.mjs`, then manually check the new selects/buttons on phone-width layouts.
8. Run `npm run coach:bump-cache` after all coach-app edits are final.

## Tests still needed from the requested Definition of Done

- Real analysis-run creation and all provenance columns.
- Atomic no-partial-write behavior through `analyzeAndSync`, not just the pure validator.
- Historical output retention through two database-backed reruns.
- Coach-reviewed row protection with the new run IDs.
- Database trigger behavior for `ai_original` across approve, edit, and reject.
- Optional rejection reason.
- Pipeline JSON stamp test for normal, no-contact, and low-quality paths.
- UI no-action rendering and latest-run comp/drill selection.
- Full existing Node and coach test suites.

## Documentation still required

The README and architecture/status docs have not been updated by this implementation. Update them only after integration tests establish what is actually shipped. Document:

- context fields and explicit unknown handling;
- analysis provenance and all version identifiers;
- no-action and two-finding behavior;
- structured pitch/emergency-swing behavior;
- lossless coach feedback and finding identity;
- `knowledge/claims.json`, `knowledge/schema.json`, and `knowledge/version.json`;
- the owner-review process for adding claims;
- the empty initial knowledge set and the fact that Gemini research is not production guidance;
- tilt exclusion and the still-unwired reconstruction module;
- manual steps and deferred Phase 2–5 work.

Do not claim future knowledge tables, ingestion, QA, analytics, promotion automation, or research UI are shipped.

## Final checks before completion

- Inspect `git diff` carefully and keep unrelated owner changes intact.
- Run `npm run build` and `npm test` with local Supabase running.
- Run a safe real clip through the Windows worker with an explicitly configured model.
- Confirm a failed AI diagnosis leaves the processed clip `ready`.
- Confirm no candidate Gemini research appears in the rendered knowledge pack or `input_manifest`.
- Produce the requested 12-part final report and end with the exact architecture question from the original request.
