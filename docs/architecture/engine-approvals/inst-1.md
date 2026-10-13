# inst-1 registration authorization and evidence

Authorization: the repository owner/user explicitly requested PR6 additive
instrumentation inst-1 in this task, including exact-hash PR1 registration.
This records task authority, not a fabricated later human review or release
approval. Independent human review of this registry remains required before
publication. No commit, push or deployment is authorized.

Engine identity remains `engine-baseline-1.0.0` / `pose3d-live-1.0.0` at original
commit `f79b09e63092e87efd1250c3b263d29086d81a79`, original protected tree
`766f4fbc64620d428da428e59b144554ca2f2a7b`. The original annotated tag is untouched.

Scope: two legacy files receive observer-only calls, and five versioned files
under `scripts/pose3d/instrumentation/` implement content verification/provenance
and hold the unchanged PR5 lock/capture snapshots. No algorithm changes,
threshold tuning, model inputs, metric changes or legacy schema changes are
authorized. A source registration cannot establish empirical equivalence.

Evidence: exact-hook AST removal restores the original two source files;
deterministic synthetic model results produce byte-identical detector JSON;
independent burned-in identity fixtures exercise CFR/VFR/HFR, actual long trim,
combined transformations, dropped/repeated frames, rebased PTS, rotation and
decoder mismatch. Lifecycle/privacy tests and the exact PR1 guard remain required.
Full evidence, limitations and independent-review reconciliation are maintained
in `docs/evaluation/pipeline-instrumentation.md`.

Explicit limitation authorized by the task: PR5-B real-video study is outstanding.
No private-video behavioral equivalence or accuracy claim is made. Deployment or
golden acceptance must not be inferred from synthetic tests or reviewer agreement.

Rollback: remove the exact inst-1 hook statements, added instrumentation files
and this registration together under a separately authorized change. Restore
the original byte-pinned source; never move the baseline tag or rewrite goldens.
Artifacts can remain as private diagnostics but must not be mistaken for baseline
goldens. Existing legacy outputs do not depend on these new files.

The machine-readable registry pins exact predecessor and final Git blobs and
the SHA-256 of this document. Any subsequent source revision must update the
draft registration before acceptance; after inst-1 is accepted, revisions require
the next cumulative registered transition. No wildcard allowance exists.
