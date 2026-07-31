# pose3d pipeline

Replacement for the MediaPipe-only prototype (`scripts/pose_analyze.py`).
Detects the batter and bat in a real 10U game clip filmed from behind the
backstop, tracks both through the clip, lifts to 3D, computes coaching
metrics, and renders an annotated overlay for visual QA.

## Quick start

```powershell
./scripts/run_pose3d.ps1 -VideoPath "videos/Emily_C_AB1 (4).mp4" -PlayerName emily_c
```

Writes to `frames/emily_c/Emily_C_AB1 (4)/`:
- `pose_2d.json` - COCO-17 2D keypoints per frame, One-Euro-smoothed, batter only
- `bat_path.json` - bat tip/knob per frame, One-Euro-smoothed
- `pose_3d.json` - 3D joints (Human3.6M skeleton) + per-frame coaching angles
  (hip-shoulder separation, torso tilt, elbow/knee angles)
- `metrics.json` - contact-instant detection + summary metrics (max bat speed,
  attack angle, hip-shoulder separation at contact, lead elbow angle at
  contact, stride) + `phases` (Stance/Load/Stride/Contact/Extension/
  Follow-through, each `{frame, time_s, method, confidence, detail}` -
  Contact is the one multi-signal-validated instant; the other five are each
  honestly capped at "low" confidence or `null` when their signal doesn't
  support a real timestamp - see metrics.py's module docstring)
- `overlay.mp4` - annotated video for visual QA (skeleton, bat trail, contact
  frame highlighted)

To feed a player's report CHECKLIST from one or more clips' `metrics.json`:

```powershell
.venv_pose3d/Scripts/python.exe scripts/pose3d/pose3d_to_checklist.py "frames/emily_c/*" out.json
```

## One-time setup

The stack is heavy (torch/CUDA, two cloned research repos, a downloaded
checkpoint) and isolated in its own venv so it can't destabilize the main
Python environment the older MediaPipe-based scripts depend on.

```powershell
python -m venv .venv_pose3d
.venv_pose3d/Scripts/python.exe -m pip install --index-url https://download.pytorch.org/whl/cu128 torch torchvision
.venv_pose3d/Scripts/python.exe -m pip install ultralytics opencv-python numpy scipy

# YOLO weights (person pose + bat detection) - place under scripts/models/
# (already gitignored, same policy as the MediaPipe model file)
# yolo11m-pose.pt and yolov8m.pt download automatically on first Ultralytics
# use if missing; this project pins them under scripts/models/ instead of the
# repo root so they don't get swept into a stray `git add -A`.

# VideoPose3D (2D->3D lift)
git clone --depth 1 https://github.com/facebookresearch/VideoPose3D.git .venv_pose3d/VideoPose3D_src
mkdir .venv_pose3d/VideoPose3D_src/checkpoint
curl -L -o .venv_pose3d/VideoPose3D_src/checkpoint/pretrained_h36m_detectron_coco.bin `
  https://dl.fbaipublicfiles.com/video-pose-3d/pretrained_h36m_detectron_coco.bin
```

No CPU-only path is documented separately: every stage runs on CPU
automatically if CUDA isn't available (`device=0 if torch.cuda.is_available()
else "cpu"` throughout) - just slower. A GPU (this was validated on an RTX
5070 Ti) takes the full 4-stage pipeline to well under a minute for a
40-second clip; CPU will take considerably longer but produces identical
output.

## Stack, and what was substituted (and why)

The original spec asked for RTMDet+RTMPose (MMPose/OpenMMLab) and MotionBERT.
Both were attempted first and are **not installable in this environment**:

| Spec's choice | Status | Substituted with | Why |
|---|---|---|---|
| RTMDet + RTMPose (MMPose) | Infeasible | **YOLO11-pose** (Ultralytics) | `mmcv`'s compiled ops have no prebuilt wheel for this machine's torch 2.11.0+cu128 build (OpenMMLab's wheel matrix lags bleeding-edge PyTorch releases). Building from source needs a local MSVC + CUDA Toolkit compiler chain that isn't present (`where cl.exe` / `where nvcc` both fail, no Visual Studio installed) - a multi-GB install out of scope here. YOLO11-pose is a different, actively-maintained, GPU-accelerated top-down detector from the same modern open-source ecosystem, not a reversion to MediaPipe. |
| MotionBERT (preferred) | Infeasible | **VideoPose3D** | MotionBERT's pretrained checkpoint is hosted on OneDrive and returns HTTP 403 to a scripted download - an interactive-auth wall, not automatable. It also expects Halpe-26 2D keypoints (via AlphaPose) rather than COCO-17, which would mean installing another heavy, fragile dependency just for format conversion. VideoPose3D's checkpoint downloads directly over plain HTTP with no auth wall, and (per its own `pretrained_h36m_detectron_coco.bin` name, confirmed by reading `data/prepare_data_2d_custom.py`) consumes raw COCO-17 keypoints directly - a strictly better fit here, and explicitly allowed by the spec's own "MotionBERT (preferred) or VideoPose3D" wording. |
| Bat detection: YOLOv8/v11 | Used as specified | - | COCO class 34 ("baseball bat") detects real game-footage bats with no custom training. |
| ByteTrack | Used as specified | - | Ultralytics' built-in `model.track(..., tracker="bytetrack.yaml")`, with an added track-continuity fix in `detect_2d.py` (see Known issues found below). |
| One-Euro filter | Used as specified | - | `one_euro_filter.py`, applied to every keypoint and the bat tip/knob independently. |

The old MediaPipe-only prototype (`scripts/pose_analyze.py`) still exists,
unused by default. Run it explicitly via `-LegacyMediapipe` on
`run_pose3d.ps1` if ever needed for comparison - it uses the **main** Python
environment, not `.venv_pose3d`, and writes to `scripts/pose_out/` in its own
CSV format, not this pipeline's JSON contract.

## Pipeline stages

0. **`locate_swing.py`** - for uploads over 60s (real coach uploads are full
   continuous at-bat recordings, not pre-trimmed single-swing clips), cheaply
   locates roughly where bat-ball contact happens via a bat-crack onset in
   the audio track (short-time energy envelope after a high-pass filter,
   peak-picked with an explicit ambiguity check), then trims to a ~12s
   window around it so stages 1-4 below only analyze that window instead of
   the whole clip. Falls back to the original untrimmed clip whenever the
   audio is missing, silent, or ambiguous (e.g. a foul ball plus the real
   contact both producing similarly loud transients) - never guesses a wrong
   window. Audio-based rather than a cheaper/faster vision pass deliberately:
   if the full-resolution model can't track a small/blurry batter, a lighter
   model over the same footage has no reason to do better at finding the
   window either, whereas audio doesn't depend on visual resolution at all.
0.5. **`decimate.py`** - for uploads over 120fps (240fps slow-mo and
   similar), subsamples down to ~30fps before the expensive stages run - a
   pure no-op for every clip below that threshold (every real clip processed
   so far is ~24-30fps). `lift_3d.py`'s VideoPose3D model has a FIXED
   243-frame receptive field baked into its pretrained weights (not a
   tunable constant) - at 240fps that's ~1.0s of real-time context instead
   of the ~8.1s it was informally validated against at ~30fps, since the
   model has no idea frames are arriving faster, it just sees 243 of them.
   Filming guidance: many phones' 240fps modes cap resolution (1080p/720p
   depending on model), trading temporal for spatial resolution - this can
   worsen small/blurry-subject tracking (the same real failure mode
   `detect_2d.py`'s quality gate above exists to catch fast) unless filmed
   tighter/closer to compensate.
1. **`detect_2d.py`** - YOLO11-pose (all people, COCO-17 keypoints) + YOLOv8
   bat detection/tracking on every frame, then:
   - **Batter identity**: builds a persistent track per detected person for
     the whole clip (greedy nearest-centroid matching), then picks whichever
     track has the strongest *cumulative* evidence of holding the bat (a
     wrist near a bat detection, summed across every frame that track
     appears in). See "Known issues found and fixed" below for why this
     replaced two simpler, both-wrong approaches.
   - **Bat tip/knob**: derived from the bat bbox's long axis, disambiguated
     by which end is nearer the batter's tracked hands; selection prefers
     ByteTrack's own track_id continuity over independently re-picking
     "nearest to hand" every frame (also covered below).
   - One-Euro-filters every keypoint and the bat tip/knob using real elapsed
     video time as the filter clock.
2. **`lift_3d.py`** - normalizes 2D keypoints (VideoPose3D's own
   `normalize_screen_coordinates`), edge-pads to the model's 243-frame
   receptive field (`common/generators.py`'s `UnchunkedGenerator` padding
   behavior, replicated directly - clips shorter than 243 frames work fine,
   they don't need a minimum length), runs the pretrained TemporalModel, then
   rotates the raw camera-space output into the same fixed "world" frame
   (Z-up) VideoPose3D's own custom-video visualizer uses (see
   `lift_3d.py`'s module docstring for why that specific rotation, not an
   arbitrary one, and how it was confirmed rather than assumed). Computes
   per-frame coaching angles: hip-shoulder separation, torso tilt, l/r elbow
   angle, l/r knee angle.
3. **`metrics.py`** - contact-instant detection + summary metrics, plus
   automated movement-pattern flags (lateral sway, knee-dominant vs.
   hip-rotation-dominant, wrist-lead timing) layered on signals it already
   computes - no new pose/video processing. See "Why contact detection
   needed two iterations" below.
3.5. **`refine_bat_speed.py`** - only runs when Stage 0.5 decimated the
   input. Re-measures peak bat speed at the TRUE original frame rate in a
   short (~1s) window around the already-found contact instant, from the
   ORIGINAL undecimated video - a cheap, bat-only pass (no full pose/3D-lift)
   over just that short window, since that's specifically what a high frame
   rate is good for (a decimated-to-30fps cadence can under-sample a fast
   bat's true peak between sampled frames). Purely additive to metrics.json
   (`max_bat_speed_full_rate`) - never replaces the decimated-cadence
   reading.
4. **`overlay.py`** - renders skeleton + bat trail + contact-frame highlight
   back onto the source video for visual QA.

`run_pipeline.py` orchestrates all four in order; `run_pose3d.ps1` is the
PowerShell entry point matching `extract_frames.ps1`'s calling convention.

## Known issues found and fixed during testing

The spec's quality bar ("wrists/hands must stay attached to the bat through
contact... output clean enough for a later Claude/GPT call to fill
CHECKLIST/ISSUES without hallucinating geometry") was checked for real by
running the full pipeline on a real clip (`videos/Emily_C_AB1 (4).mp4`,
1264 frames / ~42s) and reviewing `overlay.mp4` frame-by-frame - not just
trusting that the code ran without errors. Two real bugs were caught this way
and fixed, not shipped:

1. **Bat tracking re-picked "nearest to hand" independently every frame**,
   ignoring ByteTrack's own track_id. A single low-confidence false-positive
   detection (conf 0.169, e.g. a shadow or the catcher's glove briefly read
   as "bat") that happened to fall within the hand-distance gate got accepted
   as truth, producing a one-frame position teleport that read as an
   anatomically-impossible bat-speed spike (534 shoulder-widths/sec) once
   finite-differenced. Fixed in `detect_2d.py`'s `select_bat_box`: lock onto
   a track_id once acquired (with a lower confidence bar to *keep* trusting
   it than to *start* trusting a new one), only re-acquiring when the locked
   track is actually lost.
2. **Batter identity picked the wrong person entirely** - first via
   "largest bbox in an early frame" (the old MediaPipe-era heuristic, valid
   for that pipeline's different camera setup), which locked onto the
   **umpire** for a whole clip because this footage is filmed from behind
   the backstop, where the umpire/catcher sit much closer to the camera than
   the batter and can have a *larger* apparent bounding box. The first fix
   attempt ("seed on whichever person's wrist is nearest a bat detection in
   one early frame") still failed - a single frame's spurious bat detection
   near the catcher's glove was enough to seed the whole clip onto the
   catcher instead. Both were caught by literally looking at `overlay.mp4`
   (green skeleton was on the wrong person), not inferred from the numbers.
   The real fix (`build_person_tracks` + `build_batter_track`): build
   persistent tracks for *every* detected person across the whole clip first,
   then pick whichever track has the strongest bat-holding evidence
   *aggregated over every frame it appears in* - a wrong identity would need
   to look like the bat-holder consistently, not just once. Re-verified
   against the overlay video at multiple points across the clip (stance,
   mid-swing, follow-through) after this fix, not just at one frame.
3. **Contact-instant detection**, `metrics.py`: the first version picked the
   single global peak of bat-tip speed across the whole clip as "contact."
   This is unsafe for these clips specifically because they cover a **full
   at-bat**, not just the swing (per `extract_frames.ps1`'s own docstring
   about slow-mo timelines) - most of a clip is waiting on the pitch, not
   swinging, and a detection glitch during that dead time can look faster
   than the real swing. Fixed by requiring **both** bat speed and
   front-knee-extension to be elevated at the same frame (argmax of their
   normalized product) - dead time essentially never has a fast bat and a
   near-locked-out front knee simultaneously, so this is what actually
   isolates the real swing instant. `confidence` in `metrics.json` reflects
   whether the chosen frame is genuinely near the top of *both* signals
   individually, not just a decent average - a low-confidence reading is
   reported as such, not hidden or silently upgraded.

These are exactly the kind of failures the spec's quality bar was written to
catch, which is why `overlay.mp4` exists as a required output, not an
afterthought - the JSON alone would have looked plausible (well-formed,
populated, no errors) while being wrong in all three cases.

## Honesty / units discipline

None of this footage has real camera calibration (no known focal length,
distance to plate, or camera height), so:
- **Bat speed** is reported in body-relative units (shoulder-widths/sec), not
  a fabricated mph figure.
- **Stride length** is reported in hip-widths, not inches.
- **3D joint positions** (`pose_3d.json`) are root-relative and explicitly
  labeled "not camera-calibrated to this footage - use for angles/ratios, not
  absolute distances."
- **"Lead" arm/leg** is a documented heuristic (whichever side's ankle sits
  lower in-frame = closer to camera), not known batter handedness.
- Every number that depends on an assumption states the assumption next to
  it in the JSON, so a downstream Claude/GPT call filling in CHECKLIST/ISSUES
  text can quote the number without asserting more precision than the
  pipeline actually has.

## Feeding the existing report format

`pose3d_to_checklist.py` produces two CHECKLIST keys (`Extension`,
`Hip-shoulder separation`) in the same shape the report format expects, with
no hand-authored `windows.json` sidecar - contact timing is auto-detected per
clip (see above), and only clips where `metrics.json`'s `contact.confidence`
is `"high"` are used.
