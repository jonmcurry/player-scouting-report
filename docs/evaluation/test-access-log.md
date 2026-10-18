# Sealed test access log

Zero test evaluations have been performed. Synthetic unit tests are not test-split evaluations.

| UTC time | Engine | Access record SHA-256 |
| --- | --- | --- |

The owner pastes the exact `public_line` returned by `eval:sealed-test` only after the implementation plan section 7.5 aggregate review. No tool writes entries into this repository. The private append-only `registry/test-access.jsonl` records each execution before it starts, including failed and repeated attempts, with operator and execution provenance; its canonical line (excluding the terminating LF) is hashed here. Preserve prior entries, including unsuccessful release candidates. A hash proves byte identity, not scientific validity or a release decision.

Access records omit run_id because it is unknown before execution. A successful outcome returns run_id and access_record_sha256 together. For an interrupted execution, the owner recovers the canonical line hash and public table line from the retained private log and performs the same publication review; failure must not erase or hide the access.
