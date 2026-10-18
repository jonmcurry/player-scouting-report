# Engine runtime environment identity (PR13 smoke finding)

Status: **implemented (additive, owner-approved 2026-10-17)**.

## Observation

A person-free synthetic smoke run of the pinned baseline engine (2026-10-17, RTX
5070 Ti, driver 617.42) recorded `environment_version: env-9a6a8510dec8` with
`environment_verification: different_from_capture` and the reason
`ENVIRONMENT_DIFFERS_FROM_CAPTURE`. At the time of that finding, the sole approved and registered identity was
`env-f4ad5b330d0c` (`src/eval/environment/models.lock.json`,
`requirements.lock.txt`, `evidenceRegistry.ts` `environmentVersion`). Because the
observed tuple was not yet registered, PR8 gates withheld every clip with
`analysis_version_unavailable`.

## Root cause

1. `run_pipeline.py:60` imports `detect_2d`, which imports `ultralytics`
   (`detect_2d.py:49`).
2. `ultralytics/__init__.py:10-11` sets `OMP_NUM_THREADS="1"` when it is unset.
3. Later, `inst1.begin()` (`run_pipeline.py:131`) runs `provenance_v1.py` in a child
   process that inherits the parent environment
   (`environment_capture_scope: isolated_process_with_inherited_environment_after_engine_imports`).
4. In that child, torch reads `OMP_NUM_THREADS` at startup.

Capture inputs, lock versus inherited engine boundary (measured):

| Field | Lock / fresh process | Engine-inherited |
| --- | --- | --- |
| requirements (pip freeze) | identical | identical |
| model file hashes (3) | identical, verified | identical, verified |
| `runtime.settings.OMP_NUM_THREADS` | `null` | `"1"` |
| `runtime.settings.torchThreads` | `8` | `1` |
| every other runtime field | identical | identical |
| `environment_version` | `env-f4ad5b330d0c` | `env-9a6a8510dec8` |

Setting only `OMP_NUM_THREADS=1` on a standalone capture reproduces
`env-9a6a8510dec8` exactly; without it the standalone capture verifies
`env-f4ad5b330d0c`. PR5 (`baseline-determinism.md`, "same process after model
loading") and PR6 (`pipeline-instrumentation.md`, "Fresh isolated provenance")
already documented this process-local initialization and deliberately recorded
the actual identity rather than stamping the pre-import lock identity.

## Is the field identity-bearing, and does it matter?

- Yes. `OMP_NUM_THREADS` and `torchThreads` are explicit members of the lock's
  `runtime.settings` (validated by `capture_environment.validate_manifest`) and
  are hashed into `environment_version` (plan S0-04).
- It reflects real execution. Ultralytics sets the variable before torch
  initializes in the engine process itself, so the engine's CPU torch work runs
  single-threaded. `env-9a6a8510dec8` is therefore the truthful description of
  the runtime. `env-f4ad5b330d0c` describes a fresh shell that the engine never
  runs in. Thread count can change CPU floating-point reduction order, so it is
  legitimately reproducibility-relevant. Its effect on outputs is unmeasured.
- Historical runs were subject to the same import order. This identifies the
  label, not a change in how the engine executed.

## Capture boundary

The approved PR5 lock was taken in a fresh process. The PR6 contract captures at
the inherited post-import boundary and records mismatches truthfully. A
"code-only" correction that captures at the pre-import boundary is **rejected**:

- it would report `torchThreads: 8` for an engine that runs with 1, which is
  untruthful;
- `provenance_v1.py` is a hash-registered inst-1 file under `scripts/pose3d/`, so
  any change requires a new `inst-2` instrumentation version. That changes the
  tuple and is not code-only.

## Approved additive correction

Smallest auditable migration, without overwriting or aliasing any identity:

1. Keep `env-f4ad5b330d0c` and its lock pair unchanged as a historical, fresh-process
   identity.
2. Add a second approved capture for the engine runtime boundary, taken with the
   same capture code and `OMP_NUM_THREADS=1` (equal to the engine's
   deterministic default). It hashes to `env-9a6a8510dec8`. Store it
   as a separate lock pair (under
   `src/eval/environment/locks/env-9a6a8510dec8/`). Record the two field
   differences above as its only delta.
3. Register a separate evidence tuple with `environmentVersion: "env-9a6a8510dec8"`
   for `engine-baseline-1.0.0` / `inst-1`. Keep the existing tuple. Gate
   eligibility for new runs then follows the registered runtime identity.
4. Measure output equivalence (PR5 golden comparison) under both thread settings
   before treating any historical outputs as comparable across them.

A launcher that presets `OMP_NUM_THREADS` to any other value would still produce
a distinct, unregistered identity and be withheld, which is the intended
fail-closed behaviour.

Excluded from this migration: rewriting the existing lock, changing `provenance_v1.py`, resetting
library-initialized settings before capture, or mapping one identity to the other.

## Implemented registration and preflight

The owner-approved capture is stored at
`src/eval/environment/locks/env-9a6a8510dec8/`:

| File | SHA-256 |
| --- | --- |
| `models.lock.json` | `15a970e7af4833a3da2988c670ecf3eb89e099f9ee200bf76f5b2f3fa0affaf8` |
| `requirements.lock.txt` | `4be180910788d1c43088b08f896457c05e59c8a0f8998a0a9e974807222a82d6` |

`ENGINE_RUNTIME_EVIDENCE_TUPLE` is a second, immutable `shadow` entry with the
same engine, instrumentation, gate, proposed claims and null reliability profile.
`INITIAL_EVIDENCE_TUPLE` remains first and unchanged. Neither authorizes enforcement;
the identities are distinct, not aliases. Output equivalence between the thread
settings is unmeasured.

PR13 preflight reads the new lock pair with UTF-8 and launches read-only capture
with inherited environment variables, setting `OMP_NUM_THREADS="1"` only when
absent or empty, matching the ultralytics rule. Preset values pass through unchanged;
a mismatch fails closed. Successful capture must match the runtime identity and
resolve to a registered tuple. Run facts record
`environment_capture_boundary: "engine_runtime_inherited_omp"`; verified preflight
requires that exact boundary.

The original locks and inst-1 instrumentation are unchanged. Inst-1 manifests
still report `environment_verification` against the PR5 lock, with
`expected_environment_version: env-f4ad5b330d0c`. A runtime capture may truthfully
report `different_from_capture`. Registry resolution uses the observed
`environment_version`, not that historical expected identity.

## Verification still required

- A real GPU smoke run on at least three authorized, consented dev clips.
- A PR5 golden repeatability comparison under the runtime identity.
- Confirmation that `CUBLAS_WORKSPACE_CONFIG`, which Ultralytics sets on model
  load (`torch_utils.py:646`), is not inherited at the capture boundary. It was
  absent from the synthetic run's capture, because capture precedes model loading.
