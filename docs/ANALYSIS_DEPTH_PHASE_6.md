# Analysis depth Phase 6: local controlled-practice foundation

Phase 6 adds six versioned protocol templates, a coach-only practice-session workflow, and an ordered slot ledger. The mixed template shuffles its planned order once at creation and retains that order for the session. A coach records the actual task and environment for each rep, or marks a slot pending, missed, or failed. Existing ordinary practice reps never count automatically. Templates specify a safe environment, open-side capture, minimum attempts, and youth-safe instructions. No template prescribes a pitch velocity or unsafe equipment.

All six initial templates are pilot definitions. The migration creates no qualified reviewer or validation record. Each sport needs two distinct reviewers with service-recorded sport-specific qualifications and a documented validation decision before its result gate can open. The advanced challenge templates additionally require a completed, validated same-task repeatability set in the same practice session. The initial product can therefore record and inspect pilots but cannot yet publish an adaptability result.

An eligible rep must be recorded in the planned slot, use the actual planned task and environment, remain usable, have a ready readable original clip, and carry the supported full capture assessment. Missing, failed, deleted, unreadable, or incompatible video leaves the set incomplete or insufficient. The coach can label observed movement as consistent, changed, or unclear; after validation and completion, the view counts those coach labels among eligible reps. A changed label is never called improved: no initial template includes a validated performance criterion. No numeric cross-camera comparison, batted-ball inference, or automatic score is produced.

The coach view can list repeated readable game videos separately for visual review when at least three exist. It does not assert game transfer or alter the family progress card. Game and practice remain separate series.

## Release and validation still required

- Qualified softball and baseball coaches must validate each template's task, minimum, capture, safety instructions, and supported conclusion. Record two independent qualifications and an evidence record before release.
- Run authenticated player-scope, media deletion, duplicate-rep, and concurrency tests against a full local Supabase Auth stack before deployment. The disposable PostgreSQL fixture applied all migrations and proved a coach-scoped same-task create/read returns five pending slots and no validation release. A recorded slot survived practice-rep deletion with its link cleared and became ineligible. This is not a full Auth or media test.
- Review real footage and the signed-in mobile/wide interface. Confirm capture assessments are present for supported profiles and that incomplete sets never show conclusions.
- The Phase 0 population, consent, and methodology decisions remain open. No template validation or public release is implied by this local implementation.
