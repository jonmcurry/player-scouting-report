# HitterLoop engine v2 M2.1: evidence-aware batter selection

> M3 adds provisional PTS-based events after this decision; see [engine-v2-m3.md](engine-v2-m3.md).

Pipeline `hitterloop-v2-exp-0.2.1` adds a final decision after unchanged M1
pose eligibility and continuity splitting. M2 geometry, association and tracking
are unchanged. No longest-track fallback, swing events or M3 work is introduced.

## Rules and fixed thresholds

Only pose-eligible continuity segments compete. Each gets one unchanged
`track_bats` run. No eligible segment means the original unavailable decision is
preserved exactly; bats cannot rescue pose ineligibility.

These **unvalidated** thresholds were fixed before any real-clip evaluation:

| Threshold | Inclusive minimum |
| --- | --- |
| Exclusive detected frames / all decoded clip frames | 0.25 |
| First-to-last exclusive detection PTS span | 0.3 seconds |
| Best minus second-best exclusive fraction | 0.20 |

An absent second candidate has fraction zero. Comparisons use rational frame
fractions and PTS time, avoiding floating-point boundary errors. Segments are
never merged, including segments from the same person track.

Anti-circularity: a direct `detected` frame counts only when no other eligible
segment detects the identical chosen endpoint pair on that frame. Coordinates
use M2's two-decimal pixel rounding; endpoint order is irrelevant. Shared frames
count for nobody. Interpolated, missing and ambiguous observations never count.
Coverage is clip-level, so a short fully covered fragment cannot win by using its
own duration as the denominator.

Decisive evidence selects that segment with `basis: pose_and_bat`. Overriding a
different pose-selected segment adds `POSE_BAT_DISAGREEMENT`. Some exclusive
evidence without a decisive winner yields `ambiguous`, `basis: pose_and_bat` and
`BAT_EVIDENCE_AMBIGUOUS`, even when pose alone selected someone. No exclusive
evidence preserves the pose decision with `basis: pose_only` and
`NO_EXCLUSIVE_BAT_EVIDENCE`; bat-stage failure instead adds
`BAT_EVIDENCE_UNAVAILABLE`. Existing pose reason codes remain in these fallbacks.
Decode failures still fail closed, with the bat stage unavailable.

## Outputs

`tracks.json.grounding` contains `thresholds_sha256`, `evidence`, `pose_decision`
and `final_decision`. Evidence includes each eligible segment's `segment_id`,
`segment_frames`, `detected`, `exclusive`, `shared`, `exclusive_fraction` and
`exclusive_span_s`. The canonical SHA-256 of
`identity.PROVISIONAL_SELECTION_THRESHOLDS` is also recorded as
`engine_manifest.json.selection_thresholds_sha256`.

`tracks.batter`, `metrics.batter` and `pose_2d.meta.batter_selection` agree on the
final decision. Pose rows and `bat_path.json` follow that decision. Bat rows for
the selected segment are reused from its grounding run, never recomputed. With
no selected segment, bat output is not evaluated (or unavailable on stage failure).
The structural validator checks grounding shape, counts, hashes, decision agreement
and selected-segment pose coverage. Pipeline terminal-status logic is unchanged.

## Limitations

On-deck hitters holding bats with similar exclusive evidence yield ambiguity, but an
on-deck hitter whose bat is detected much more often than the plate batter's (for
example the batter's bat blurred or occluded) can be selected decisively, with
`POSE_BAT_DISAGREEMENT` if pose preferred someone else. Bat evidence never comes
from M2 association alone being trusted: it is compared across all eligible
candidates, but it does not prove batter identity.

Fail-closed consequences, by design: a lone pose-eligible batter with some but weak
bat evidence (under 25% of frames) becomes `ambiguous` rather than staying selected;
a batter split by M1 into two segments competes against itself and usually becomes
`ambiguous`. Exclusivity matches identical rounded endpoint pairs, so two different
masks of one bat associated to two people are each counted as exclusive. Frames where
the final batter's bat was shared with another candidate stay `detected` in
`bat_path.json` (they are excluded only from the selection evidence). Slow identity
drift inside one M1 segment, below M1's switch checks, is not detected here either.
Unchanged M1 eligibility
can exclude the real batter; unchanged M2 model and wrist/association limitations
remain. The span threshold measures first-to-last evidence, not continuous coverage.
One annotated development clip is not validation. This implementation uses
synthetic tests only and makes no real-footage accuracy claim.

## Verification

Synthetic and local development checks (2026-10-19). Thresholds were fixed in the
implementation spec before any real clip was evaluated and were not changed afterwards.

| Check | Result |
| --- | --- |
| `npm run test:engine-v2` | 50 pass (M1, M2 and M2.1 grounding tests) |
| Engine TypeScript tests; full `npm test`; baseline, media, eval-isolation, brand guards | pass |
| Local development check on a small set of authorized clips | grounding resolved clips that pose-only selection left ambiguous; where an owner annotation existed, the selected track matched it |

These local checks are development examples, not validation; detailed per-clip results
are kept locally and are not published. No accuracy or reliability claim is made. Knob
error is unchanged by M2.1 (geometry was not modified) and remains an open M2
limitation: it lies mostly along the bat axis, with the mask running past the knob on
some frames and short of it on others.
