# Analysis depth Phase 5: local comparison foundation

Phase 5 adds coach-only, versioned comparison sets. It does not add adaptability protocols, external-instrument imports, or public performance claims. No measurement definition was validated or promoted in this session.

## Baseline and evidence rules

- Migration `00059_comparison_sets.sql` stores a versioned set and one ledger row for each active same-player attempt at build time. An authorized, enabled coach can inspect saved versions or narrow a new version by excluding attempt IDs. Game and practice versions are separate. Concurrency uses a player/definition/series transaction lock.
- A numeric definition needs a service-only `comparison_definition_releases` record tied to its latest validated decision. The recorded approver must differ from the definition author and validation decision maker. The migration creates no release record; experimental or merely validated definitions remain unavailable to coaches until independent approval is recorded.
- A reference requires known sport, intent, batting environment, supported full capture assessment, named profile/version, and known orientation. Each member must match those fields and have a current numeric result for the exact validated definition, visible included evidence, and adequate capture checks. Unknown or unsupported metric requirements fail closed.
- A descriptive distribution appears only when the definition is currently validated and declares at least five eligible swings as its minimum. It reports median, quartiles, eligible and excluded counts, and date range. Individual values and controlled exclusion reasons remain inspectable below the minimum.
- A snapshot is never silently recomputed. Source revision, reprocessing, validation change, or deletion makes the old version stale and masks its values. A deletion request immediately clears derived member values. A new coach request creates a new version.
- A definition may explicitly associate a validated game distribution with the current deterministic focus concept; that evidence is descriptive and never changes the existing focus status, one-fix rule, or family/share payload.

## Pending release gates

- The Phase 0 independent reviewers, per-metric thresholds, population/profile validation, and approved change rules remain pending. There are no released fingerprint dimensions or trend statements. The coach page explains this when no definition qualifies.
- All migrations through 00059 applied to a disposable local Supabase PostgreSQL container. A direct SQL fixture verified a five-value median of 3 and IQR of 2, stale masking after evidence-package removal, deletion redaction, distinct versions under two concurrent builds, and the unrelated-user access gate. Removing the release record left zero definitions available and made the saved set stale. The container was removed afterward.
- `npm run test:comparison-sets` still needs a running local Supabase Auth endpoint and migrations through 00059. Its fixture covers coach/guardian isolation, self-approval rejection, sample count, narrowing, concurrent versions, reprocessing and validation-decision staleness, and deletion redaction. It creates a local test definition only; no real definition is promoted.
- Authenticated mobile and wide rendering with actual signed video and enough validated results remain a manual release check. No migration or app build was deployed.
