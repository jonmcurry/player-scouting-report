# HitterLoop engine v2 M2: bat geometry and tracking

> M3 adds provisional PTS-based events; see [engine-v2-m3.md](engine-v2-m3.md).

> M2.1 adds evidence-aware final batter selection in `hitterloop-v2-exp-0.2.1`; see [engine-v2-m2.1.md](engine-v2-m2.1.md).

Experimental, development-only bat stage inside the separate v2 engine
(`hitterloop-engine-v2-exp`, pipeline `hitterloop-v2-exp-0.2.0`). It produces
temporally labelled bat observations for later event work. It makes no swing,
coaching or accuracy claim, and the protected baseline engine is unchanged. M1
decoding, person tracking, continuity and batter selection are unchanged; see
`engine-v2-m1.md`.

## Model

| Field | Value |
| --- | --- |
| Model | Ultralytics YOLO11m-seg, task `segment`, COCO-80 |
| Class | 34 = `baseball bat` (verified from the checkpoint's own class map at load) |
| File | `scripts/models/pr5-baseline-recovery/yolo11m-seg.pt`, read in place, shared with the offline privacy tool |
| Size / SHA-256 | 45,400,152 bytes / `eb9a06f63e2206c35d68d839b08c362429ebecf933ad54c1ad68b2fd001c17cf` (also in `baseline-determinism.md`) |
| Provenance | Checkpoint metadata: saved by Ultralytics 8.2.100 on 2024-09-25; AGPL-3.0 |
| Download | None. The file already existed; `YOLO_OFFLINE=1`. |

Missing file, size/hash mismatch, a non-segment task or a different class 34 make
the bat stage `unavailable` (`BAT_MODEL_MISSING`, `BAT_MODEL_HASH_MISMATCH`,
`BAT_CLASS_MAP_MISMATCH`). There is no fallback to boxes or to other weights.
Inference uses `classes=[34]`, `retina_masks=True` (masks at the displayed raster)
and a low score floor; the score is stored as an uncalibrated model score. Masks
are reduced to geometry immediately and never written.

## Mask to segment

Pixel-index coordinates in the displayed raster, PTS from M1 (`bat_geometry.py`):

1. Connected components (OpenCV, 8-connectivity). Specks under 5% of the mask are
   ignored. Another significant component is merged only when it continues the same
   bat: its centroid's perpendicular offset from the largest component's axis is at
   most one mask width, and its along-axis gap is at most four mask widths (an
   occlusion-sized break such as a hand crossing the handle): `fragmented: true`. Any
   other significant component, including a collinear object far beyond the barrel,
   rejects the mask (`FRAGMENTED_MASK`). The merged shape is re-checked for a defined
   axis.
2. Principal axis from the pixel covariance. Near-isotropic shapes are rejected
   (`DEGENERATE_AXIS`).
3. Endpoints are the 0.1% / 99.9% trimmed extremes of the pixel projections onto
   the axis, placed on the axis through the centroid. Width is the trimmed spread on
   the minor axis. Length/width below 3 is `NOT_ELONGATED`. Empty or tiny masks are
   `EMPTY_MASK` / `TOO_FEW_PIXELS`. The trim trades a small inward bias for
   resistance to attached stray pixels (synthetic max error 1.46 px at 0.1% vs 4.0 px
   at 0.5%).

No endpoint ever comes from an axis-aligned box.

## Association, knob/tip and tracking

Runs after M1 batter selection, only on the selected batter's frames
(`bat_track.py`). Lengths are in batter-box heights (H).

- **Hands**: midpoint of both confident wrists; one confident wrist is used but
  marked `SINGLE_WRIST`; none is `missing` / `NO_CONFIDENT_WRIST`.
- **Eligibility**: geometry accepted, length 0.1-1.0 H (`IMPLAUSIBLE_LENGTH`), and
  an endpoint within 0.25 H of the hands (`NOT_NEAR_BATTER_HANDS`, e.g. an on-deck or
  second bat). A candidate with the same orientation (within 15 degrees) whose
  endpoints both lie within 0.05 H of an already-kept segment is the same physical bat
  (for example a handle-only mask beside the full mask); the longer observation is
  kept. A crossing object is never folded into the bat.
- **Competing candidates**: cost = hand reach + continuity with the last direct
  detection (within 0.1 s). If the runner-up is within 0.1 H of the best, the frame is
  `ambiguous_candidate` (`MULTIPLE_BAT_CANDIDATES`) and nothing is assigned.
- **Knob/tip**: the knob is the end nearer the hands when the two distances differ
  by at least 20% of the bat length (`knob_source: "hands"`). Continuity with the
  previous direct detection (within 0.1 s) is consulted only when the bat barely
  moved (combined endpoint motion at most 0.5 H) and it is itself decisive; during
  fast rotation positions cannot tell the ends apart, so the hands alone decide.
  When the hands are indecisive, decisive continuity resolves the frame
  (`"temporal_continuity"`); otherwise it is `ambiguous_orientation`
  (`ENDPOINT_IDENTITY_AMBIGUOUS`) with the two unlabeled `endpoints`. If the hands and
  decisive continuity disagree (for example a wrist glitch while the bat is still), the
  frame is `ambiguous_orientation` (`ENDPOINT_FLIP_CONFLICT`); identities are never
  silently reversed.
- **Segments**: `track_id` is an integer bat segment; a new one starts after a gap
  longer than 0.1 s. A knob moving faster than 12 H/s (measured over at least 30 ms)
  relative to a recent direct detection is another object or a bad mask: the frame is
  `ambiguous_candidate` with `BAT_TRACK_DISCONTINUITY`, nothing is assigned, and the
  earlier bat stays the continuity reference until the window lapses. While that
  reference is recent, any later candidate nearer the rejected position than the
  trusted bat stays rejected (the rate against a fixed reference would otherwise fall
  below the limit a frame later); the real bat reappearing near its previous position
  is accepted. The hold is a nearest-position rule and clears when the window lapses,
  even across frames without a pose. Two consequences, both bounded by the 0.1 s
  window: a real bat that moves into the region nearer the rejected position is also
  held (fail closed), and an object that drifts back nearer the trusted position than
  the rejected one is judged by the ordinary rate limit again.
- **Interpolation**: only between two `detected` frames of the same segment no more
  than 0.1 s apart, across frames that are `missing` only because nothing usable was
  seen (`NO_CANDIDATE`, `REJECTED_GEOMETRY`, `IMPLAUSIBLE_LENGTH`). Linear in PTS
  time. Status `interpolated` with `INTERPOLATED_SHORT_GAP`; geometry lives only in
  `interpolated` and never in `tip`/`knob`. Frames with a competing or unassociated
  bat, longer gaps and gaps across segments stay as they are.

All values are in `PROVISIONAL_BAT_THRESHOLDS` (`identity.py`), **unvalidated**; the
canonical-JSON hash is in `bat_path.json` and the manifest.

## Artifact contract additions

`bat_path.json` is now produced. `meta` repeats pose raster fields exactly (`fps`
nominal, `width`, `height`, `n_frames`, `time_base`, `rotation`, `vfr`) plus engine
identity, `bat_status`, `bat_reason_codes`, model identity (`pinned_sha256` and the
`loaded_sha256` actually verified at load, or `test_double`), `score_semantics`,
`endpoint_names` (`tip` = PR3 `barrel_end`), thresholds hash and a summary (counts per
status, batter frames, direct-detection coverage).

`bat_status`: `observed` (at least one direct detection), `not_detected` (model ran,
none associated), `not_evaluated` (no batter selected, `NO_BATTER_SELECTED`),
`unavailable` (model identity or runtime failure, or a decode failure
`DECODE_UNAVAILABLE`). A bat-stage failure never changes the batter result or
`pipeline_status.status`; `detail` gains `bat_status` and `bat_reason_codes`.

One frame per decoded frame. Baseline-compatible keys `frame`, `time_s`, `pts`,
`tip`, `knob`, `conf`, `track_id`; `tip`/`knob`/`conf` are non-null only for
`detected`, so existing consumers (capture assessment, subject box, evidence signals,
PR11 normalizer) see direct observations only. Additive keys: `status` (`detected`,
`interpolated`, `ambiguous_orientation`, `ambiguous_candidate`, `missing`,
`not_evaluated`), `reason_codes`, `knob_source`, `endpoints`, `interpolated`,
`length_px`, `width_px`, `angle_deg`, `elongation`, `candidate_count`, `fragmented`.
`pose_2d.meta.bat_evidence` is still not written.

The worker now requires `bat_path.json` with v2 identity in `meta`. The v2 worker path
is otherwise unchanged: no phases, inconclusive, no AI. The baseline path is unchanged.

## Limitations

- The pretrained COCO bat class is unvalidated on real swings, youth or softball
  bats, motion blur at contact, and backstop-fence occlusion. It detected no bat in
  any synthetic rendering (5 angles x 2 backgrounds, score floor 0.05), so synthetic
  imagery says nothing about real detection rates.
- Hands are approximated by wrists (COCO-17 has no hand keypoints).
- Association depends on M1 batter selection; no batter means no bat observations.
- Fragment gaps are measured against the largest component only, so a mask broken
  into three or more pieces spanning a long gap is rejected (fail closed).
- After the bat has been unseen for more than 0.1 s, a single bat-shaped object at the
  batter's hands is presumed to be the batter's bat. Distinguishing two bats held at
  the same hands needs appearance information this stage does not have.

## Verification

Synthetic media and masks only (2026-10-19). Implemented directly by Claude while
Codex was rate-limited.

| Check | Result |
| --- | --- |
| `npm run test:engine-v2` | 36 pass (M1 16 + M2 20) |
| Known-geometry masks (10 angles x 3 lengths, tapered) | endpoint error max 1.46 px, mean 1.04 px; angle error max 0.03 deg |
| Degenerate / fragmented / occluded / blurred masks | rejected or flagged with the documented reasons; collinear far object rejected |
| Association, identity, discontinuity, interpolation, VFR, sparse | as documented, including a 150 deg/frame rotation with moving hands staying `detected` and consecutive-frame jump rejection |
| End to end (`run_engine` with doubles) | schema-valid, byte-identical across runs; bat failures leave the batter result and status unchanged; non-null tip/knob only on `detected` |
| Real model, offline | loads with pinned hash and class 34; 0 masks on synthetic renders; 30 frames at 720p in 0.23 s on the RTX 5070 Ti |
| Full engine on 300 frames at 1080p, GPU | decode+track 15.8 s (M1 alone 12.9 s), of which bat segmentation 2.7 s |
| Engine TypeScript tests; full `npm test`; baseline, media, eval-isolation, brand guards | pass |

Not verified: any real bat detection, endpoint accuracy on real swings, or real
association behaviour; these need authorized annotated footage.
