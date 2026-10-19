# HitterLoop engine v2 M1

> M2 adds the bat stage and moves the pipeline to `hitterloop-v2-exp-0.2.0`, which now
> also writes `bat_path.json`; see `engine-v2-m2.md`. This document describes M1 as built.

Experimental, development-only original-upload decoder, person-pose tracker and
conservative pose-only batter selector. This is an engine skeleton, not validated
swing analysis. Enable with `ANALYSIS_ENGINE=v2-exp`, a loopback Supabase URL
(`localhost`, `127.0.0.1` or `::1`) and a non-production `NODE_ENV`. Other engine
names and an unsafe v2 configuration fail at worker startup. Unset/empty/baseline
keeps the existing engine. No production flag defaults change.

The worker uses `.venv_engine_v2/Scripts/python.exe` on Windows or
`.venv_engine_v2/bin/python` elsewhere (`ENGINE_V2_PYTHON` overrides it).
The environment must already contain PyAV, Ultralytics, Torch and NumPy. No
packages or weights are installed by this implementation. `YOLO_OFFLINE=1` and
a native-head check prevent the automatic ReID classifier fallback. The existing
`scripts/models/yolo11m-pose.pt` is read-only. `--device` defaults to `auto`
(`cuda:0` when CUDA is available, otherwise CPU); the resolved device is recorded
in the manifest. `--max-frames` defaults to 12000. Crashes print a traceback to
stderr for the worker log; it is never written to `pipeline_status.json`.

## Contract

`python -B scripts/engine_v2/run_engine.py <original-video> <out-dir>` streams every
presentation frame through PyAV and one persistent BoT-SORT tracker. Coordinates
refer to the displayed raster after exact quadrant rotation. Timing comes from
integer PTS × rational stream time base, never index/fps. Frame records are small
metadata/pose records; decoded image arrays are not retained. Nominal FPS is
reported separately and does not describe VFR timing. VFR means at least one
delta differs from the median by more than one stream tick.

All JSON artifacts carry `engine=hitterloop-engine-v2-exp` and
`pipeline_version=hitterloop-v2-exp-0.1.0` (in `meta` for pose):

- `frame_map.json`: schema `hitterloop.engine-v2.frame-map` version `1.0.0`, direct
  original presentation indices, PTS/time base, key-frame flag, input hash,
  dimensions/rotation and timing aggregates.
- `pose_2d.json`: baseline-compatible COCO-17 names/order; raw unsmoothed model
  keypoints rounded to 2/2/3 decimal places. Frames outside the selected segment
  are null. All frames are null if unavailable/ambiguous. `meta.fps` is nominal
  only; `meta.bat_evidence` is deliberately absent.
- `tracks.json` (diagnostic only; the worker does not read it): observations, continuous segments, PTS gaps/jumps, proportion
  signatures via step differences, candidate scores and decision reason codes.
- `metrics.json`: the six existing phase slugs each have null frame/time and
  `not_produced_in_m1`. Swing detection is `not_produced`, confidence null.
  No contact, angle, speed or summary metric is produced.
- `engine_manifest.json`: package/FFmpeg-library versions, device/native ReID,
  model and tracker hashes, canonical-JSON threshold hash, input hash/size,
  stage wall times and frame counts.
- `pipeline_status.json`: written last with atomic replacement; `complete`,
  `analysis_unavailable` or `crashed`, reason codes and UTC `written_at`.

Rotation is read from each decoded frame's display matrix, then the stream
`rotate` tag. PyAV 18.1.0 has no reader for a stream-level display matrix, so a
container whose matrix FFmpeg does not copy onto decoded frames would decode
unrotated; FFmpeg 8.1 did copy it for every authored 90/-90/180 test clip, whose
orientation matches FFmpeg's own autorotation. The worker also compares the decoded rotation with the independent ffprobe
capture probe for any result it would ingest and fails closed with
`ROTATION_MISMATCH`; verify phone footage before trusting it.

Known artifact names (including obsolete 3D/bat outputs) are removed at start.
No media is copied, and no `pose_3d.json` or `bat_path.json` is produced. An
unavailable batter still produces all diagnostic artifacts. Decode failures
produce partial diagnostic maps, explicitly unavailable, with no selected pose.
An unexpected crash can leave partial artifacts; only terminal status is assured
when the output directory is writable. No implementation can write terminal
status after forced process termination or an unwritable output directory.

The worker isolates outputs under `frames/<player>/<clip>/engine_v2`, validates
all required artifact identities, permanently fails deterministic unavailable
results, and retries crashes/missing artifacts. Complete v2 ingestion targets the
claimed clip ID, replaces all phase rows with explicit nulls and deletes the old
summary metrics row. It deletes old 3D frames, records capture/attempt information,
marks swing detection inconclusive, and skips AI diagnosis. Baseline output paths
and ingestion remain separate. DB integration tests are in the existing serial
`uploadQueue.test.ts`; they must be run by the orchestrator against its test DB.

## Provisional thresholds and reasons

All selection/continuity thresholds live in `identity.PROVISIONAL_THRESHOLDS`.
They are **unvalidated**: confidence .5 (keypoints), .25 (boxes), centre motion
5 box-heights/second, measured against the latest row of the same segment at
least 30 ms earlier and never divided by less than 30 ms (so 120-240 fps jitter
is not read as speed, while a nearby 0.2-height swap still splits at 30 fps and above,
including 33/34 ms steps in 1/1000 time-base phone video; at 24-25 fps a jump
must exceed about 0.21 heights), scale ratio 1.6, pose-proportion change .5, gap .5 seconds,
minimum segment duration .5 seconds, wrist separation ≤1 shoulder width,
minimum grip and hands-above-hips fractions .6, and score margin .15. Scores
average grip fraction, hands-above-hips fraction and normalized median size.
Only eligible continuous segments compete; there is no longest-track fallback.

Continuity reasons are `CENTRE_JUMP`, `SCALE_JUMP`, `PROPORTION_SHIFT`, `LONG_GAP`.
Every suspicion splits the track. Selection reasons are `BATTER_AMBIGUOUS`,
`BATTER_UNAVAILABLE`, `NO_PERSON_DETECTED`, `INSUFFICIENT_GRIP_EVIDENCE`,
`SEGMENT_TOO_SHORT`. Decode reasons are `MISSING_PTS`, `NONINCREASING_PTS`,
`NO_VIDEO_STREAM`, `DECODE_ERROR`, `CLIP_TOO_LONG`, `UNSUPPORTED_ROTATION`.
Offline setup failures use `MODEL_MISSING` or `REID_NATIVE_FEATURES_UNAVAILABLE`;
unexpected failures use `UNEXPECTED_EXCEPTION` and the exception class.

M1 has no bat detection, swing events, AI diagnosis, smoothing, accuracy claims,
new reports, UI changes or migrations. Game/practice semantics are unchanged.

## Worker lifetime and verification

Both engines have a positive `PIPELINE_TIMEOUT_MINUTES` (default 45). Timeout
terminates the process tree (`taskkill /T /F` on Windows; detached process group
on POSIX) and takes the existing retry path. `CLAIM_HEARTBEAT_SECONDS` defaults
to 60 and must be positive and strictly less than half the stale-claim interval.
Heartbeats compare the exact DB-returned claim timestamp, processing status and
clip ID. Success replaces the token with the returned stored timestamp; errors
log and retry; a null result aborts the pipeline and prohibits subsequent clip
state writes. Heartbeat and write operations serialize to avoid racing a known
lost-claim result. Renewal stops when a terminal state write succeeds.

`npm run test:engine-v2` uses synthetic media in temporary directories only;
missing interpreter reports a loud SKIPPED message. Native ReID smoke runs on
CPU and skips only if weights are absent. Invalid PTS cases that muxers reject
or repair test the decoder validator directly. CFR/VFR compare against authored
timestamps and ffprobe. End-to-end byte comparisons freeze injected wall/UTC
clocks: real manifests and status timestamps necessarily differ across runs.
No production timing is replaced with a fabricated constant.

`duration_s` written to `video_clips` by v2 ingestion is the PTS span from the
first to the last decoded frame, not container duration (it omits the final
frame interval).

## Verification (2026-10-19, synthetic media only)

| Check | Result |
| --- | --- |
| `npm run test:engine-v2` | 16 pass: CFR/VFR PTS equal authored values and `ffprobe` presentation order; VFR time never equals index/fps; 90/-90/180 rotation matches FFmpeg autorotation; fail-closed decode reasons; continuity splits (240 fps jitter, segment-start jitter, 0.5-height jump, 0.2-height nearby swap at 30 and 240 fps and on a 1/1000 time base); ambiguous/unavailable selection; byte-identical artifacts with frozen clocks; offline native-ReID smoke |
| Engine TypeScript tests | 13 pass, including the rotation cross-check and real Windows `taskkill /T /F` process-tree timeout and abort |
| Full `npm test` (local dev Supabase, no worker running) | Pass; serial DB tests include the exact-timestamp heartbeat CAS and v2 ingestion clearing seeded baseline phases/summary |
| Baseline, media, eval-isolation, brand, registration guards; `git diff --check` | Pass |
| GPU smoke, person-free 300-frame 1080p clip | `analysis_unavailable` (`NO_PERSON_DETECTED`); `auto` resolved to `cuda:0`; decode+track 12.9 s (CPU: 33.3 s) |

Known limit: continuity checks compare adjacent rows (centre over a 30 ms window),
so an identity change spread slowly over many frames can avoid every reason code;
only real annotated footage can show how often that happens.

Not verified: any real footage (none authorized), batter selection or identity
continuity on real people, and a full worker run of the v2 path end to end. M2
(bat geometry) has not started.
