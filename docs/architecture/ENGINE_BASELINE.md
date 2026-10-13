# Original analysis engine baseline

PR1 / S0-01 preserves the original implementation before instrumentation or algorithm changes. The local annotated tag is `engine-baseline-1.0.0`. Publishing that tag requires separate user authorization. The source identity is:

| Identity | Recorded value |
| --- | --- |
| Original commit (full SHA) | `f79b09e63092e87efd1250c3b263d29086d81a79` |
| `scripts/pose3d/` Git tree SHA | `766f4fbc64620d428da428e59b144554ca2f2a7b` |
| Engine identifier / `engine_code_version` | `engine-baseline-1.0.0` |
| Existing `PIPELINE_VERSION` / `pipeline_version` | `pose3d-live-1.0.0` |
| Original instrumentation version | `none` (uninstrumented) |
| Environment version | `uncaptured` (no environment lock or weight hashes recorded by PR1) |

The commit identifies the whole original repository. The subtree hash identifies all 13 original files under `scripts/pose3d/`, including the orchestrator, detection, smoothing, lifting, correction, phase/metric calculations, rendering, and documentation. It does not identify external weights, Python dependencies, the VideoPose3D checkout, GPU drivers, Node postprocessing, or provider output. The existing pipeline version is read from `scripts/pose3d/run_pipeline.py`; preserving it does not validate the engine's accuracy.

## Preservation rules

- Never move, replace, or reuse the original annotated tag. A maintenance release receives a new engine identifier; the original source and golden-output reference remain the commit above.
- Freeze the original algorithms, thresholds, tracking logic, geometry, models, phase semantics, and smoothing. Algorithm improvements belong in `scripts/engine_v2/` in separately authorized Stage 2 work.
- Under `scripts/pose3d/`, permit only reviewed instrumentation with its own version, or narrowly scoped security/crash maintenance with a new engine patch version. No exceptions are registered in PR1.
- Instrumentation may add diagnostic artifacts but must not change core analysis outputs. Before approving it, compare against private goldens from the **uninstrumented original commit**, as required by S0-04/S0-05. Do not generate the reference goldens from instrumented code.
- Environment capture is S0-04; instrumentation is S0-05. Neither is implemented here. Python/package versions, model weight hashes, VideoPose3D revision, OS, hardware and drivers belong to an independently identified environment. An environment version cannot authorize a source change.
- Model weights are outside this tree and must remain unchanged for baseline comparisons. This source guard neither downloads nor validates weights. Source identity alone cannot prove runtime determinism or output equivalence across environments.

## Reproduce the original source checkout

From a repository with the original commit and locally created annotated tag:

```sh
git rev-parse 'engine-baseline-1.0.0^{commit}'
git rev-parse 'engine-baseline-1.0.0:scripts/pose3d'
git cat-file -t refs/tags/engine-baseline-1.0.0
git worktree add --detach ../hitterloop-engine-baseline f79b09e63092e87efd1250c3b263d29086d81a79
```

The first two outputs must equal the recorded hashes and the third must be `tag`. Git identity is verified without replacement objects by the guard. The detached worktree reproduces source only; it does not install dependencies or provide weights. Do not run the historical setup/download instructions as part of PR1. On an already provisioned, authorized evaluation host with the original dependencies and weights present, the original entry point is:

```sh
python scripts/pose3d/run_pipeline.py /private/path/to/consented-input.mp4 /private/path/to/new-output-directory
```

Run from the detached checkout with the correct existing Python environment and model/research-repository paths. The original entry point checks for missing YOLO weights and the VideoPose3D checkpoint and stops when they are absent. Preflight their presence and use an offline host. The environment and private golden-output reproduction procedure remains S0-04 work. No real video analysis or golden generation is needed to run the PR1 source tests.

## Guard and exception registry

Run `npm run check:baseline` directly, or `npm test` (which runs the guard and its adversarial tests before the existing suite). The guard reads this single JSON block. Baseline identity is also pinned in the guard; editing the document cannot select a new baseline or fall back to HEAD. Missing history, a missing/lightweight/moved tag, invalid policy, unregistered additions/deletions, mode changes, symlinks, and content mismatches fail closed. CI/checkouts must contain the original commit and annotated tag. Until publication is authorized, another checkout must receive the tag through an explicitly authorized local transfer; after publication, fetch that exact tag and sufficient history. The guard never fetches or creates it automatically.

<!-- baseline-policy:start -->
```json
{
  "schemaVersion": 1,
  "baseline": {
    "tag": "engine-baseline-1.0.0",
    "commit": "f79b09e63092e87efd1250c3b263d29086d81a79",
    "tree": "766f4fbc64620d428da428e59b144554ca2f2a7b",
    "pipelineVersion": "pose3d-live-1.0.0"
  },
  "engineCodeVersion": "engine-baseline-1.0.0",
  "pipelineVersion": "pose3d-live-1.0.0",
  "instrumentationVersion": "inst-1",
  "environmentVersion": "env-f4ad5b330d0c",
  "exceptions": [
    {
      "id": "pr6-inst-1",
      "kind": "instrumentation",
      "instrumentationVersion": "inst-1",
      "reason": "Observer-only frame identity/provenance artifacts; preserve original analysis behavior.",
      "validation": "Exact observer removal restores original AST; synthetic burned-in identity and model-double output tests. Real-video goldens remain unverified; see docs/evaluation/pipeline-instrumentation.md.",
      "approval": {
        "approvedBy": "Repository owner/user (explicit PR6 task authorization)",
        "document": "docs/architecture/engine-approvals/inst-1.md",
        "sha256": "4ce02cffd8628605b71eafe71ed509b961fff2a20c550e2380ff4636c4ebc5a1"
      },
      "files": [
        {
          "path": "scripts/pose3d/run_pipeline.py",
          "before": {
            "blob": "75beda65d8e4cc70a4e2e21a647ea3e2f075a075",
            "mode": "100644"
          },
          "after": {
            "blob": "df5f952c7d049fd2c03b09880924a633023fa649",
            "mode": "100644"
          }
        },
        {
          "path": "scripts/pose3d/detect_2d.py",
          "before": {
            "blob": "7d0970de22b61ed2d3737bf267200d846bcbb33c",
            "mode": "100644"
          },
          "after": {
            "blob": "86547d9c261ccef8eae7f81ec79c2e1a6dfdbfb5",
            "mode": "100644"
          }
        },
        {
          "path": "scripts/pose3d/instrumentation/inst1.py",
          "before": null,
          "after": {
            "blob": "3c2babc4cffa21e2b3619a4355792599bf9844bf",
            "mode": "100644"
          }
        },
        {
          "path": "scripts/pose3d/instrumentation/provenance_v1.py",
          "before": null,
          "after": {
            "blob": "1e4e438ca2735e35b0669282d6d5c91985eb15f9",
            "mode": "100644"
          }
        },
        {
          "path": "scripts/pose3d/instrumentation/capture_environment_v1.py",
          "before": null,
          "after": {
            "blob": "76ff45ee4b5121111ce7a2c1bce8bac36a89f536",
            "mode": "100644"
          }
        },
        {
          "path": "scripts/pose3d/instrumentation/models.lock.json",
          "before": null,
          "after": {
            "blob": "7c5c0dcd57524f3fd84d64665657a7010f05c07b",
            "mode": "100644"
          }
        },
        {
          "path": "scripts/pose3d/instrumentation/requirements.lock.txt",
          "before": null,
          "after": {
            "blob": "df317c634ae67f217cf6f1aef26c673a80f42d33",
            "mode": "100644"
          }
        }
      ]
    }
  ]
}
```
<!-- baseline-policy:end -->

The `exceptions` array is the instrumentation allowlist and maintenance registry.
PR1 initialized it empty; PR6 registers the exact `inst-1` observer-only revision.
Its environment reference is the PR5 capture, not a guarantee every runtime matches
that capture. See `docs/evaluation/pipeline-instrumentation.md` for the outstanding
real-video equivalence gate. No wildcard or directory entry is accepted. Entries
are ordered, cumulative transitions and must include:

| Field | Requirement |
| --- | --- |
| `id`, `kind`, `reason`, `validation` | Unique identifier, `instrumentation` or `maintenance`, rationale, and a description of regression/golden evidence |
| `approval` | `approvedBy` names the authorized reviewer; `document` is an exact Markdown path under `docs/architecture/engine-approvals/`; `sha256` is the SHA-256 of that document's bytes |
| `files` | Nonempty list of `{path, before, after}`. Paths are exact repository-relative files under `scripts/pose3d/`. Each state is `{blob, mode}` using a Git blob SHA and `100644` or `100755`; `null` means absent. Each `before` must equal the previous registered state. Each `after` pins precisely the reviewed content. |
| Instrumentation entry | `instrumentationVersion` is the next `inst-N` (starting at `inst-1`); engine and pipeline versions stay unchanged |
| Maintenance entry | `category` is `security` or `crash`; `engineCodeVersion` and `pipelineVersion` advance together to the next `1.0.x` patch, including the literal stamp in `run_pipeline.py` |

The active versions at the top of the block must equal the versions derived from this history. Registrations cannot authorize subsequent edits to an allowlisted path; every new revision needs another exact transition. Working files must match the final registered state. The index may contain original or final approved states while a change is being prepared, but arbitrary staged content is rejected even if the working copy was restored.

The guard uses Git blob content and regular-file modes, permits CRLF-only text checkout differences on Windows, and does not invoke Git clean filters. On Windows, where executable bits are not represented by the filesystem, it checks the index mode. Standard `__pycache__/*.pyc` files are ignored as runtime environment artifacts; ignored Python source files are still checked. This is a source-preservation control, not a runtime sandbox or a defense against deliberately modifying the guard/test workflow itself. Changes to the guard, its tests, this registry, and approval documents require independent human review. A recorded name and document hash establish an auditable reference, not proof of a person's authority or of semantic equivalence.

Empty directories are harmless because Git does not track them. Although the historical `.gitignore` also lists `scripts/pose3d/models/`, the actual detector loads weights from `scripts/models/` (`detect_2d.py`, `MODELS_DIR`), and the refiner imports that same path. Extra files under the unused `scripts/pose3d/models/` path are deliberately rejected; there is no broad ignored-directory bypass. PR1 neither moves nor alters any local weights.

## Legitimate maintenance

A maintenance exception must fix a documented security vulnerability or reproducible crash. Accuracy tuning, new model weights, contact-threshold changes, coordinate corrections, and phase reinterpretation are algorithm changes and are not maintenance exceptions. The approval record must identify the defect, named product-owner authorization and independent reviewer, exact file revisions, regression evidence, expected output impact, and rollback. The guard verifies the record's existence/hash, exact source revisions, permitted category and patch-version changes; reviewers verify the record's truth and adequacy. A behavior-changing security/crash fix must disclose that impact and cannot be presented as the unchanged original baseline. The original tag and original goldens remain untouched.

PR1 changes only source governance and test tooling. Application and engine source remain at their pre-PR1 contents. Runtime output equivalence on real footage is not claimed without the provisioned environment and private goldens.
