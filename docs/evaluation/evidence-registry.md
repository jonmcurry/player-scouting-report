# PR7 evidence registry and configuration

Foundational only: no production call sites import these modules. Nothing reads
or sets running-environment flags. Reports, AI calls, recommendations, focus and
video workers retain their existing behavior. No PR8 evidence calculations exist.

## Versions and schema

`src/services/development/evidenceRegistry.ts` provides a compatibility catalog,
not a replacement owner for protected Python versions. A drift test checks the
active registration in `ENGINE_BASELINE.md` and the legacy pipeline constant.
PR7 preflight verified the annotated tag `engine-baseline-1.0.0`, original commit
`f79b09e63092e87efd1250c3b263d29086d81a79`, Pose3D tree
`766f4fbc64620d428da428e59b144554ca2f2a7b`, and the unchanged guard's 18 files.
The tag object remains `47ac6ef85cdfca186c23a0ebcc644c4bf4b5e3ae`.

The sole initial entry is:

| Field | Value |
| --- | --- |
| engineCodeVersion | `engine-baseline-1.0.0` |
| instrumentationVersion | `inst-1` |
| environmentVersion | `env-f4ad5b330d0c` |
| gateVersion | `gate-1.0.0` |
| claimsVersion | `claims-0.1.0-proposed` |
| reliabilityProfileVersion | `null` |
| status | `shadow` |

Gate/strict/proposed-claims constants in `evidence/version.ts` reserve S0-06's
names; they do not assert implemented gates or approved concept requirements.
PR8 can import these constants; no empty claim-requirements implementation is
introduced. The strict comparator identifier is `strict-0.1.0`, outside the tuple.
No prompt, evidence-package or reconstruction version is changed.

The captured environment is not historical-output provenance or an assertion
that every runtime has this identity. Consumers must use observed manifest
versions, never fill missing fields with the initial tuple. The legacy
`pose3d-live-1.0.0` mapping identifies **only** the baseline engine: it supplies no
instrumentation, environment, gate, claims or reliability fields. Unknown stamps
return null, including the separate unwired reconstruction identifier.

## Resolution and enforcement

`resolveTuple` accepts exactly six own tuple fields, requires exact equality for
all of them, and rejects unknown, malformed, ambiguous/duplicate and retired
matches. Lifecycle values are `shadow`, `enforce_candidate`, `enforced`, `retired`.
Catalogs and returned entries are immutable. A malformed catalog fails closed.

`assertEnforceableTuple` additionally requires the requested engine, `enforced`
status, non-null reliability version, non-proposed claims and all five metadata
fields: `reliabilityReference`, `d7ApprovalReference`,
`enforcementApprovalReference` (S1-12), `approvedBy` (opaque reviewer ID), and
`approvedAt` (canonical UTC timestamp). References are restricted opaque IDs,
not names, private paths or URLs. Approval fields are absent in the initial entry.

These are structural checks, not proof that referenced records are true, adequate
or authentic. Future catalog changes require review of the actual D7/S1-12 and
calibration records. No measurements, approvals or reliability profiles are
manufactured. Synthetic enforce fixtures occur only in tests. Resolver injection
supports offline catalog validation; the configuration parser always uses the
fixed production catalog and exposes no registry override.

## Configuration and runtime sharing

| Variable | Accepted values | Default |
| --- | --- | --- |
| EVIDENCE_GATE_MODE | off / shadow / enforce | off |
| REPORT_EVIDENCE_GATE_MODE | off / shadow / enforce | off |
| REPORT_LEGACY_RUN_POLICY | show_as_before / legacy_safe_only | show_as_before |
| ANALYSIS_ENGINE | engine-baseline-1.0.0 | engine-baseline-1.0.0 |

Unknown values throw. Null, empty, case-changed, padded and non-string values
are not coerced. Absent/undefined keys use defaults; unrelated environment keys
are ignored. Errors name the key without echoing its value. Either enforce mode
requires an explicitly supplied exact observed tuple and all enforcement checks;
both are rejected for every current tuple. No environment approval bypass exists.

`parseAnalysisFlags` is pure; `readAnalysisFlags` takes a getter and reads only
the four known keys. Future Node callers can supply `key => process.env[key]`,
and Deno callers `key => Deno.env.get(key)`. Import has no environment reads or
network access. The Edge shim re-exports the same implementation using native
Deno `.ts` imports; Node loads the shim through tsx for parity tests. The Node
build rewrites only imports under `src/` to `.js`, not the Edge shim. There are no Node-only
transitive dependencies or imports from future evidence computations.

The acceptance table is shared by Node tests and
`scripts/tests/analysis-flags.deno.ts`. The Node suite also loads the actual Edge
shim through tsx and compares every result. Native Deno verification is separate:
`deno test --no-config --no-remote scripts/tests/analysis-flags.deno.ts`.
No Deno executable was found on this Windows host; native Deno execution and
Supabase bundling/deployment are **unverified**, not passed. No installation or
deployment was attempted.

## Verification and remaining work

Local Windows verification (2026-10-13): 61 focused registry/configuration tests
pass, including the actual Edge shim under Node. Full `npm test` passes: PR5
environment/comparator 9/14, PR6 instrumentation 25, privacy guard 54 (3 platform
skips), privacy adapters 62, baseline guard 13, migration guard 3, drills 13,
annotations 82, compiled suite 461 (1 skip), coach/brand 248. `npm run build`
and `git diff --check` pass. The protected-source guard verifies all 18 registered
files. Initial sandbox attempts could not spawn subprocesses (EPERM); the same
checks passed with authorized subprocess execution. Focused tests were rerun
after tightening lifecycle validation to reject non-string values without coercion.

No real-video runs were performed. PR5-B repeatability, PR6 real
behavioral equivalence, calibration, concept review, S1-12 approval, and separately
authorized environment reconstruction remain outstanding. This registry does
not establish accuracy, repeatability, or production enforcement readiness.

PR7 file inventory (other local PR5/PR6 changes are preserved):

- `src/services/development/evidenceRegistry.ts`
- `src/services/development/evidenceRegistry.test.ts`
- `src/services/development/evidence/version.ts`
- `src/services/config/analysisFlags.ts`
- `src/services/config/analysisFlags.test.ts`
- `src/services/config/analysisFlags.cases.ts`
- `supabase/functions/_shared/analysisFlags.ts`
- `scripts/tests/analysis-flags.deno.ts`
- `package.json` (focused test script and addition to the existing local pretest)
- `NEXT_STEPS.md` (PR7 entry only)
- `docs/evaluation/evidence-registry.md`

No application version bump: this is unused foundational infrastructure; existing
application, pipeline, instrumentation and prompt versions are unchanged. No
staging, commit, push, deployment, cloud mutation or running flag changes occurred.
Visual QA is not applicable because no UI or rendered behavior changed.

## Independent review

The repository orchestrated QA wrapper completed successfully using the available
`Gemini 3.8 Flash (High)` reviewer; tests were run separately (`-SkipTests`).
Record: `.git/gemini-review/review-20261013-131103-bad490.md`. No blocking findings.
Codex independently reconciled all findings:

- Corrected the build-rewriting comment/documentation: tsc processes `src/`,
  while the Edge shim stays TypeScript. Extended Node shim parity to test both
  the parser and getter adapter; focused tests/build were rerun. No runtime
  behavior changed after review.
- The proposed-claims suffix rule covers the sole current claims version.
  Future claim naming must retain this convention or explicitly strengthen
  approval-state validation. Names alone never authorize enforcement: the exact
  trusted catalog entry still needs all D7/S1-12/reliability references. Authenticity
  of those records remains a human review gate; PR7 does not implement PR16.
- Native Deno and Supabase packaging of cross-directory imports must be verified
  before future Edge integration. Existing functions already share source this
  way, but that is not proof of deployment compatibility for these new modules.
- Future local Edge consumers need explicit environment delivery (secrets mapping
  or env file). No mapping is added now: this task forbids enabling running flags.
  Edge consumers belong to later integration work, not PR8 evidence calculations.

No unresolved PR7 implementation blocker or product decision remains. Native
runtime/deployment verification and future approval-record governance remain
explicit limitations, not review-certified capabilities.
