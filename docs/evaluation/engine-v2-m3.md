# HitterLoop engine v2 M3: provisional swing events

Pipeline `hitterloop-v2-exp-0.3.0` adds pure event detection after the final M2.1
batter and bat decisions. Decoding, tracking, continuity, eligibility, mask
geometry, association, grounding and their threshold mappings are unchanged.
These events are experimental estimates, not validated coaching findings.

## Definitions and PR3 mapping

| Event | Method / evidence | Existing phase |
| --- | --- | --- |
| `stance_set` | Start of the latest continuous still interval of hands and both ankles before launch | stance |
| `load_peak_estimate` | Interior pre-launch hand extremum opposite the barrel displacement direction over the launch bracket; auxiliary extremum, not onset | load |
| `stride_foot_lift` | First upward excursion exceeding the threshold for the ankle with the larger excursion | none |
| `foot_plant` | First later return below the excursion threshold with low ankle speed | stride |
| `swing_launch` | First sample after the last sub-threshold speed before impact in the same direct run | none |
| `impact_estimate` | Highest supported barrel-speed sample, with two supporting adjacent derivative samples and sufficient local rotation | contact |
| `extension` | Largest wrist-midpoint to shoulder-midpoint distance in the post-impact window; auxiliary pose event | extension |
| `finish` | Start of the first sustained low-speed interval after impact | follow_through |
| `load_start`, `contact_confirmed` | Always unavailable, `NOT_PRODUCED` (or `NO_SELECTED_BATTER` when identity is unavailable) | none |

The PR3 impact event describes estimated hitting-zone passage. M3 implements a
barrel-speed proxy, without a plate/pitch-path observation: **impact is an estimate,
not contact**, and its accuracy against PR3 timing remains unverified. The legacy
`contact` phase name does not assert contact. No outcome, take, ball interaction,
weight transfer or ground force is inferred. No AI/report change is included.

## Timing and direct evidence

All derivative and search intervals use integer source PTS multiplied by the
rational time base, including negative/nonzero origins. `time_s` is copied from
the frame map for display and ingestion; it is never a derivative clock. No time
is computed from index/fps. Speeds divide by the selected batter's current-frame
box height H. Hands require both confident wrists; shoulders require both
confident shoulders, using the unchanged pose confidence floor.

Only `detected` bat rows contribute barrel position (`tip`). The mask axis
`angle_deg` is oriented toward that tip relative to the wrist midpoint, then
unwrapped within a continuous direct run. **Knob position is unused** by events,
hand paths and angles. Interpolated and ambiguous rows cannot contribute.
Derivatives stop at missing source frames, missing observations, bat track changes
or PTS gaps above 0.10 s; this deliberately does not bridge even short missing
observations. Local rotation is the range of unwrapped directions within the
continuous run intersected with the peak's ±0.25 s window.

Impact's uncertainty spans the previous and next direct frames. Launch uses its
two bracketing speed samples. Finish's window spans the low-speed support period;
stance's window spans the stable run. Pose extrema/lift/plant use singleton
windows. Every available event carries source frame, PTS, display time, method,
observation type, support counts/values and reasons.

Load searches `[launch - load_search_s, launch)`, strictly excluding launch.
If the selected extremum is the first or last confident hand sample in that
search window, the peak is unresolved: `LOAD_PEAK_AT_WINDOW_EDGE`, with no
reported frame. A boundary value is not a resolved load peak and cannot remove
the launch anchor.

Strict partial order: stance < launch, load extremum < launch, stance < load
extremum, lift < plant, lift < launch, launch < impact < finish (see "Review-driven
ordering and use rules" for how the last additions resolve). Stance/launch and load/launch conflicts invalidate the
pose event (`stance_set` or `load_peak_estimate`) with `EVENT_ORDER_CONFLICT`,
never the bat-derived launch anchor. Bat-derived pairs (launch/impact and
impact/finish) and lift/plant still invalidate the later event. Times are never
adjusted. Plant need not precede launch.
Anchors must remain available: stance and load require launch; stride lift and
plant require launch and impact; extension and finish require impact. Launch
itself is located relative to impact. When an order conflict invalidates launch
or impact, its dependent events become unavailable with
`DEPENDS_ON_UNAVAILABLE_EVENT`, transitively. Phase entries and timeline markers
reflect these final statuses; unavailable impact cannot yield `swing_candidate`.

## Fixed, unvalidated thresholds

`identity.PROVISIONAL_EVENT_THRESHOLDS` was fixed before any real-clip evaluation.
Canonical sorted compact JSON is SHA-256 hashed in metrics and the manifest.

| Threshold | Value |
| --- | --- |
| max_derivative_gap_s | 0.10 |
| min_swing_peak_speed_h_per_s | 4.0 |
| min_swing_rotation_deg | 90.0 |
| rotation_window_s | 0.25 |
| peak_support_fraction | 0.4 |
| launch_speed_fraction | 0.25 |
| finish_speed_fraction | 0.15 |
| finish_sustain_s | 0.10 |
| extension_search_s | 0.30 |
| stance_search_s | 2.0 |
| stance_still_h_per_s | 0.25 |
| stance_min_s | 0.30 |
| load_search_s | 1.5 |
| stride_search_s | 1.5 |
| foot_lift_h | 0.03 |
| foot_plant_h | 0.015 |
| foot_plant_still_h_per_s | 0.3 |
| ankle_conf | 0.5 |
| min_batter_box_fraction | 0.12 |
| min_bat_length_h | 0.20 |
| foreshortened_fraction | 0.5 |

## Gates and missing data

No selected batter makes every event unavailable (`NO_SELECTED_BATTER`).
`pose_only` grounding suppresses impact, launch, finish and load with
`IDENTITY_NOT_BAT_GROUNDED`. A pose/bat selection disagreement adds
`POSSIBLE_BATTER_CONFLICT` to available events and sets the diagnostic conflict flag.
Median batter height / raster height below 0.12 or more than half of direct bat
lengths below 0.20 H suppresses bat-derived events with
`UNSUPPORTED_CAMERA_GEOMETRY`; diagnostics record measured fractions and
`SMALL_BATTER` / `BAT_HEAVILY_FORESHORTENED`.
Both identity and camera gates also make stance, stride lift, foot plant and
extension unavailable with the same gate reason. Pose observations cannot retain
an event whose launch/impact anchor was suppressed by these gates.

Derivative samples are considered in descending speed order (source order breaks
ties). The first supported moving sample is selected: both neighbouring
derivatives must exist, be connected, share its bat track, and each reach
`peak_support_fraction` times its speed. Unsupported higher spikes are skipped;
impact support records `rejected_spikes` and `max_rejected_spike_h_per_s` (null
when none were rejected). Stationary zero-speed samples are not moving peaks.
Only then are the unchanged minimum speed and rotation tests applied. A supported
peak below either minimum yields low-confidence `no_swing_candidate`; post-stance
produced events become not applicable with
`NO_SWING_CANDIDATE`. The two never-produced events retain `NOT_PRODUCED`.
If no supported moving peak exists but a derivative reaches the minimum swing
speed, impact is unavailable with `INSUFFICIENT_PEAK_SUPPORT` and detection is
`not_evaluated`, never `no_swing_candidate`. Without any derivative samples,
impact remains unavailable with `BAT_MISSING_NEAR_IMPACT`; entirely stationary
or sub-minimum evidence remains `no_swing_candidate`.
An available impact gives low-confidence `swing_candidate`. Identity, geometry
and unavailable evidence yield `not_evaluated`, confidence null. None yields
`no_swing` or high confidence. Missing ankle coverage fails closed with
`ANKLES_NOT_VISIBLE`; only a continuously visible window with no threshold
excursion gives `NO_STRIDE_DETECTED`. The foot baseline is the median over the
first 0.30 s of the observed search window, which must span at least 0.30 s.

## Outputs and worker compatibility

`metrics.json.events` is an ordered list, with `events_schema` =
`hitterloop.engine-v2.events` and `events_schema_version` = `1.0.0`. Each event's
method version is `v2-event-1.0.0`. Available phases mirror events with method
`v2:<event id>` and uncertainty window; other phases have null frame/time and
their event's first reason code. Metrics add diagnostics and threshold hash.
`events_timeline.json` contains per-frame PTS/time, barrel/angular speed, direct
flags and event markers. It is local diagnostic output, not worker input.

The worker validates source-frame phase time within 1e-6 and v2 method prefix;
ingestion preserves method and keeps confidence null. Located phases make the
existing detection state readable; other candidate states remain inconclusive.
The v2 branch still returns before AI diagnosis. Extraction accepts a filtered
list of located phases and handles an empty list; no extraction change is needed.

`python -B scripts/engine_v2/overlay_events.py <video> <engine_out_dir> <dest_mp4>`
is a separately invoked local diagnostic. It verifies the source hash and PTS
map, draws in displayed source coordinates, uses a hollow muted knob and labels
events with PTS. It refuses destinations resolving inside the Git working tree,
existing destinations and operation without Git. It is never called by the
engine or worker. Synthetic overlay verification writes outside the repository.

## Review-driven ordering and use rules

- `stance_set` must precede `load_peak_estimate`. On conflict both become unavailable
  `EVENT_ORDER_CONFLICT` (the latest still window before launch may be the loaded pause
  rather than the stance, so neither is trusted); `swing_launch` is kept.
- `stride_foot_lift` is reported only strictly before `swing_launch`; otherwise it is
  unavailable `STRIDE_LIFT_NOT_BEFORE_LAUNCH` (a lift at or after launch is a heel pivot),
  and `foot_plant` is then unavailable as well.
- Every event carries `downstream_use`: `not_recommended` for available `swing_launch` and
  `stride_foot_lift` (definition limitations below), `experimental` for other available
  events, null when unavailable. Neither is mapped to a phase slug, so the app never sees
  them; later milestones must not consume them until redefined and checked on
  independently annotated clips.
- `ingestPhases` refuses v2 artifacts unless called by the worker v2 path with the claimed
  clip id, so a standalone run cannot skip the v2 identity checks and clean-up.

## Limitations

Single-camera 2D projection is not physical bat speed or 3D rotation. Perspective,
occlusion, motion blur, wrist error and M2 endpoint uncertainty affect timing.
The camera gates are coarse proxies, not calibrated viewpoint classification.
The larger-excursion ankle is a heuristic lead foot, not anatomical side evidence.
Plainly, `swing_launch` is where barrel speed first reaches
`launch_speed_fraction` × peak when walking back from impact. This threshold
crossing is later than the visible onset of forward motion. The lead foot is
the ankle with the larger upward excursion; during a rotational swing this can
be the back heel rather than the stride foot. Both definitions are provisional
and need independently annotated clips before any change. Neither definition
nor its thresholds is changed by the load-window and order-conflict fixes.
Only the first supported peak is evaluated per clip; failure of its speed or
rotation test does not start a search for another swing. Short clips, missing
observations, identity splits and ambiguous rotations intentionally lose events.
Synthetic trajectories test implementation contracts, not real-world accuracy.

## Verification

Synthetic and local development checks (2026-10-19), thresholds unchanged after the first
real-clip run. Review-driven logic fixes (peak support, gate cascade, load window, order
direction, the rules above) were made from defects, not to produce particular events.

| Check | Result |
| --- | --- |
| `npm run test:engine-v2` | 73 pass, including the M2.1 zero-frame decode regression |
| Engine TypeScript tests; full `npm test` (local dev DB, including a stored `v2:impact_estimate` phase); baseline, media, eval-isolation, brand guards | pass |
| Local development check on a small set of authorized clips | every available event's `pts`/`time_s` equalled its frame-map entry |

Qualitative behaviour seen in that local check (development examples, not validation;
detailed per-clip results are kept locally and are not published):

- `foot_plant` was often unavailable (`FOOT_PLANT_NOT_OBSERVED`).
- `finish` often loses direct bat coverage after impact as the mask length collapses
  (`INSUFFICIENT_BAT_COVERAGE_AFTER_IMPACT`).
- `load_peak_estimate` often lands on the search-window edge (`LOAD_PEAK_AT_WINDOW_EDGE`).
- `swing_launch` lands only a few frames before impact: it marks where barrel speed
  reaches 25% of the peak walking back from impact, later than the visible onset.
- Where an owner annotation existed, the located post-launch events fell inside the
  human-marked approximate swing window, which is not a contact timestamp.
