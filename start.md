Implement the next unfinished phase in docs/ANALYSIS_DEPTH_SRD.md.

Treat that SRD, docs/SIMPLIFIED_APP_SPEC.md, NEXT_STEPS.md, AGENTS.md, and DESIGN.md as authoritative. Preserve HitterLoop’s youth-first core loop: WATCH → UNDERSTAND → FOCUS → TRAIN → RECHECK. Do not turn the family experience into a professional analytics dashboard; advanced capabilities must use progressive disclosure for coaches and advanced athletes.

Before editing:

1. Inspect the repository, current branch, git status, existing uncommitted changes, architecture, schemas, tests, and relevant UI.
2. Identify the next incomplete SRD phase and give me a concise implementation plan, including dependencies, migration risks, and acceptance criteria.
3. Make reasonable decisions from the existing product rules, but stop and ask me before any unresolved product decision that would materially affect privacy, minors, data retention, report semantics, pricing, or the core experience.

Then implement that phase completely:

- Reuse existing components, design tokens, and patterns.
- Preserve the original video as the source of truth.
- Fail closed when evidence is insufficient.
- Never invent findings, measurements, progress, drills, or precision.
- Keep softball and baseball distinct where their mechanics or terminology differ.
- Support youth, high-school, college, and professional users through configuration and progressive disclosure—not separate products.
- Preserve one primary fix per readable at-bat in the family report.
- Keep optional pitch/approach context staff-only.
- Keep minors’ annotations guardian-visible by default.
- Add or update tests for all new behavior, including missing and low-quality evidence.
- Update NEXT_STEPS.md with completed work and remaining tasks.
- Follow the project’s versioning and changelog rules if this phase creates a user-visible capability.

After implementation:

1. Run focused tests and the appropriate broader test suite.
2. Review the complete diff for regressions, unsupported claims, privacy concerns, migration safety, and consistency with the SRD.
3. Run the required orchestrated Gemini QA workflow from AGENTS.md.
4. For frontend changes, perform rendered visual QA against DESIGN.md and clearly report if manual visual QA is still required.
5. If an Android emulator is already running and coach/mobile code changed, rebuild and install according to AGENTS.md.
6. Report files changed, behavior added, tests and QA results, unresolved findings, known limitations, and git status.

Do not commit, push, deploy, publish fixtures, or modify cloud data unless I explicitly authorize it after reviewing the implementation.


I’d recommend adding the specific phase so the scope stays manageable. For the first implementation session, change the opening to:

> Implement Phase 0 and Phase 1 from `docs/ANALYSIS_DEPTH_SRD.md`. Do not begin later phases during this session.

After reviewing that work, use the same prompt with “Phase 2,” then proceed phase by phase. This avoids a massive implementation that becomes difficult to test, review, or safely undo.