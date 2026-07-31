"""
Stage 3 of the pose3d pipeline: turn pose_2d.json + pose_3d.json + bat_path.json
into the summary coaching metrics.json the I/O contract asks for (max bat
speed, attack angle/swing plane, hip-shoulder separation at contact, lead
elbow angle at contact, stride length/direction).

Contact-instant detection: no ball/plate calibration exists for this footage,
so contact time is inferred, not measured directly - same honesty stance the
old MediaPipe-era pipeline took with its hand-authored windows.json + alignment
check (scripts/pose_to_checklist.py). Here it's automatic instead of
hand-authored, but for the same reason that pipeline needed a human to pick a
window in the first place: these are full at-bat clips (per
scripts/extract_frames.ps1's own docstring), mostly NOT the swing - waiting on
pitches, resets, walk-up. Trusting the global peak of either bat-speed or
knee-extension alone is unsafe over a clip like that (see find_contact_frame's
docstring). Contact is instead the frame where BOTH signals are elevated
together (argmax of their normalized product) - the two-independent-signals
idea pose_to_checklist.py already used for the same trust reasons, just
combined jointly instead of sequentially. confidence is "high" only when this
frame is genuinely near the top of both signals individually (not just an
average compromise) - see the confidence calculation in run().

Units discipline: pose_3d.json's joints are root-relative and NOT
camera-calibrated to this footage (see its own meta.units note), so nothing
here reports absolute real-world distances/speeds. Bat speed and stride
length are reported in body-relative units (shoulder-widths/sec,
hip-widths) derived from this clip's own 2D pixel measurements - honest,
comparable across clips of the same player, not a fabricated mph/inches
figure.

"Lead" arm/leg selection: batter handedness/orientation isn't known from
video alone, so this reuses the same heuristic pose_analyze.py validated for
"front leg" (whichever side's ankle sits lower in frame = closer to camera)
extended to picking the lead (front) arm too, and is documented per-clip
in the output rather than silently assumed.

Swing-phase detection (result["phases"]): Contact is the only phase with a
ball/plate-independent, multi-signal-agreement method (see above); the other
five (Stance, Load, Stride, Extension, Follow-through) each get their own
detector below (find_stance_frame, find_load_frame, find_stride_frame,
find_extension_frame, find_follow_through_frame), all searching a bounded
window relative to the already-found contact frame rather than the whole
clip, and all returning frame=None with an explicit reason rather than a
fabricated timestamp when their signal doesn't support one. They are NOT
equally trustworthy - each docstring says so plainly, from Extension
(reuses an already-film-calibrated knee-angle threshold) down to Stance and
Load (state-boundary/no-dedicated-signal heuristics, confirmed by direct
frame-image inspection to sometimes land on an unrelated moment, see
find_stance_frame's own docstring) - never presented as more certain than
they are.

Usage: python metrics.py <clip_dir>
  (expects pose_2d.json, pose_3d.json, bat_path.json already in clip_dir)
"""
import sys
import json
import math
import pathlib

ALIGNMENT_TOLERANCE_S = 0.5
ROTATION_MIN_DEG = 3.0

# All of these were originally raw frame-count windows (e.g. window=2,
# half_window=2, a 10-frame lookback) - implicitly tuned against this
# pipeline's real reference footage, which runs ~29.4-30fps (confirmed
# against 3 real clips: 30.005/29.360/29.827fps - round(2/30 * fps) == 2 for
# all three, so this conversion reproduces today's exact behavior, not an
# approximation). Converting to a fixed TIME span, resolved to a frame count
# via each clip's own real fps at the point of use, keeps their meaning
# consistent regardless of a clip's actual frame rate - a fixed frame-count
# window covers 8x LESS real time at 240fps than at 30fps, which would make
# rotation-activity-style degree thresholds read ~8x smaller for the same
# real motion and likely never clear their gates.
ROTATION_WINDOW_S = 2 / 30
ATTACK_ANGLE_WINDOW_S = 2 / 30
FRONT_SIDE_LOOKBACK_S = 10 / 30

L_ANKLE_2D, R_ANKLE_2D = 15, 16
L_HIP_2D, R_HIP_2D = 11, 12
L_SHOULDER_2D, R_SHOULDER_2D = 5, 6
L_WRIST_2D, R_WRIST_2D = 9, 10

# Extension confidence gate - same 155deg value already calibrated against
# real film in pose3d_to_checklist.py's EXTENSION_THRESHOLDS. Not imported
# directly (these are sibling pipeline-stage scripts communicating via the
# metrics.json file, not via direct import - matching this pipeline's
# existing loosely-coupled, JSON-mediated stage architecture), just the same
# real number, duplicated with this comment so the two don't silently drift.
EXTENSION_HIGH_CONF_DEG = 155.0

# Stride/plant speed floor, in hip-widths/second - calibrated empirically
# against all 7 real emily_c clips (see scripts/pose3d/README.md's
# ground-truth notes): real front-ankle plant motion measured 0.6-1.4
# hip-widths/frame at these clips' ~30fps (18-40 hip-widths/s instantaneous),
# while genuinely static pre-swing frames measured 0.07-0.15 hip-widths/frame
# (2-4.5 hip-widths/s) - a 6 hip-widths/s floor cleanly separates the two
# without being tuned to one single clip's exact numbers.
STRIDE_SPEED_MIN_HIP_WIDTHS_PER_S = 6.0
STRIDE_SUSTAIN_S = 3 / 30

# Movement-pattern flags (new) - margin in normalized [0,1] percentile units.
KNEE_DOMINANT_MARGIN = 0.15
# Reuses find_load_frame's own 2.5s backward-window default for the wrist-
# lead comparison, rather than a new, separately-tuned value.
WRIST_LEAD_SEARCH_S = 2.5


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def median(vals):
    vals = sorted(vals)
    n = len(vals)
    if n == 0:
        return None
    mid = n // 2
    return vals[mid] if n % 2 else (vals[mid - 1] + vals[mid]) / 2


def body_scale_px(pose_2d_frames):
    """Median shoulder width and hip width in pixels, over tracked frames only -
    the reference scale for turning pixel measurements into body-relative units."""
    shoulder_w, hip_w = [], []
    for f in pose_2d_frames:
        kp = f["keypoints"]
        if kp is None:
            continue
        ls, rs = kp[L_SHOULDER_2D], kp[R_SHOULDER_2D]
        lh, rh = kp[L_HIP_2D], kp[R_HIP_2D]
        if ls[2] > 0.15 and rs[2] > 0.15:
            shoulder_w.append(dist(ls, rs))
        if lh[2] > 0.15 and rh[2] > 0.15:
            hip_w.append(dist(lh, rh))
    return median(shoulder_w), median(hip_w)


def bat_speeds(bat_frames, fps):
    """Per-frame bat-tip speed in px/s (centered finite difference), None where
    either neighbor frame has no tip detection."""
    speeds = [None] * len(bat_frames)
    for i in range(1, len(bat_frames) - 1):
        a, b = bat_frames[i - 1]["tip"], bat_frames[i + 1]["tip"]
        if a is None or b is None:
            continue
        speeds[i] = dist(a, b) / (2.0 / fps)
    return speeds


def knee_extension_series(pose_3d_frames):
    """Per-frame max(l_knee, r_knee) angle - None where neither side has a
    valid reading. One raw signal candidate is not enough to find contact
    reliably (see find_contact_frame's docstring for why)."""
    out = []
    for f in pose_3d_frames:
        a = f["angles"]
        vals = [x for x in (a["l_knee_angle_deg"], a["r_knee_angle_deg"]) if x is not None]
        out.append(max(vals) if vals else None)
    return out


def rotation_activity_series(pose_3d_frames, fps, window_s=ROTATION_WINDOW_S):
    """Per-frame body-rotation angular speed: |shoulder_line_deg change| over
    a small centered window (fixed real-time span, resolved to a frame count
    via this clip's own fps - see ROTATION_WINDOW_S's comment for why this
    must be time-based, not a raw frame count). Added after a real false
    positive was caught by watching the overlay video: a pre-pitch bat
    WAGGLE produced a bat-tip speed spike (a real, fast, single-frame wrist
    motion) at a moment verified (by reading the actual angle values, not
    guessing) to have completely static hip/shoulder line angles for 15+
    surrounding frames - the batter's whole body wasn't rotating, only her
    wrist was. A real swing's hip/shoulder angles change rapidly and
    continuously through the same window (verified the same way against a
    real contact instant). Bat speed and knee extension alone can't tell a
    waggle from a swing; requiring the body to actually be rotating can."""
    n = len(pose_3d_frames)
    window = max(1, round(window_s * fps))
    out = [None] * n
    for i in range(window, n - window):
        a = pose_3d_frames[i - window]["angles"]["shoulder_line_deg"]
        b = pose_3d_frames[i + window]["angles"]["shoulder_line_deg"]
        if a is None or b is None:
            continue
        out[i] = abs(b - a)
    return out


def _minmax_norm(series):
    """Map a list with Nones to [0, 1] over the non-None values; None stays None."""
    vals = [v for v in series if v is not None]
    if not vals:
        return [None] * len(series)
    lo, hi = min(vals), max(vals)
    span = hi - lo
    if span < 1e-9:
        return [0.5 if v is not None else None for v in series]
    return [(v - lo) / span if v is not None else None for v in series]


def find_contact_frame(speeds, knee_series, rotation_series):
    """Full at-bat clips (this project's slow-mo footage covers an entire
    at-bat, per scripts/extract_frames.ps1's own docstring) are mostly NOT the
    swing - waiting on pitches, resets, walk-up. The old MediaPipe pipeline
    sidestepped this by having a human hand-pick a contact window per clip
    (windows.json). This pipeline auto-detects instead, which means picking
    the single global peak of bat speed and knee extension is unsafe: a bat
    sitting still between pitches can still produce a one-frame detection
    jitter that reads as "fast," and a batter simply standing can hit full
    knee extension outside the swing.

    A real false positive of the original (speed x knee) two-signal version
    was caught by watching the overlay video, then confirmed by reading the
    actual angle data (not guessing): a pre-pitch bat WAGGLE produced the
    single fastest bat-tip reading in the entire clip while the batter's
    hip/shoulder angles stayed completely static for 15+ frames around it -
    a real swing's body is actively rotating through the same kind of
    window. rotation_series (see rotation_activity_series) adds that as a
    required third signal: contact = argmax(bat_speed_norm * knee_norm *
    rotation_norm) over frames where all three are present. Dead time
    (standing, waggling, walking) essentially never has a fast bat, a
    near-locked-out front knee, AND active body rotation all at once.
    """
    speed_norm = _minmax_norm(speeds)
    knee_norm = _minmax_norm(knee_series)
    rot_norm = _minmax_norm(rotation_series)
    best_i, best_score = None, -1.0
    for i in range(len(speed_norm)):
        if speed_norm[i] is None or knee_norm[i] is None or rot_norm[i] is None:
            continue
        score = speed_norm[i] * knee_norm[i] * rot_norm[i]
        if score > best_score:
            best_i, best_score = i, score
    return best_i, best_score, speed_norm, knee_norm, rot_norm


def front_side_at(pose_2d_frames, fps, idx):
    """'l' or 'r' - whichever ankle sits lower in frame (closer to camera) at
    the given frame index, falling back to nearby frames (fixed real-time
    lookback, resolved via fps) if untracked."""
    lookback = max(1, round(FRONT_SIDE_LOOKBACK_S * fps))
    for j in range(idx, max(idx - lookback, -1), -1):
        kp = pose_2d_frames[j]["keypoints"]
        if kp is None:
            continue
        l_ank, r_ank = kp[L_ANKLE_2D], kp[R_ANKLE_2D]
        if l_ank[2] > 0.15 and r_ank[2] > 0.15:
            return "l" if l_ank[1] > r_ank[1] else "r"
    return None


def attack_angle_at(bat_frames, fps, idx, half_window_s=ATTACK_ANGLE_WINDOW_S):
    """Degrees, +up/-down, of the bat tip's velocity direction averaged over a
    small window (fixed real-time span, resolved via fps) centered on idx.
    Image y grows downward, so dy is negated to report "upward swing" as
    positive, matching normal attack-angle convention."""
    half_window = max(1, round(half_window_s * fps))
    i0 = max(idx - half_window, 0)
    i1 = min(idx + half_window, len(bat_frames) - 1)
    a, b = bat_frames[i0]["tip"], bat_frames[i1]["tip"]
    if a is None or b is None:
        return None
    dx = b[0] - a[0]
    dy = -(b[1] - a[1])
    if dx == 0 and dy == 0:
        return None
    return round(math.degrees(math.atan2(dy, dx)), 1)


def phase_search_window(contact_frame, fps, n, pre_s=0.0, post_s=0.0):
    """Bounded frame-index window relative to the already-found contact frame
    - never the whole clip. Same principle as max_bat_speed's existing
    ALIGNMENT_TOLERANCE_S window: a full at-bat clip is mostly dead time
    between pitches (confirmed on real data - e.g. Emily_C_AB1_game2 is a
    465s clip with no swing in it at all), so every phase below anchors off
    the one reliably-located instant instead of searching the full clip."""
    i0 = max(contact_frame - int(round(pre_s * fps)), 0)
    i1 = min(contact_frame + int(round(post_s * fps)), n - 1)
    return i0, i1


def keypoint_speed_series(pose_2d_frames, fps, keypoint_idx):
    """Per-frame speed of a given 2D keypoint index, in px/s (centered finite
    difference, same method as bat_speeds), None where either neighbor frame
    lacks a confident keypoint. Generic over which keypoint (originally
    ankle-only - renamed since the body already worked for any index; used
    for front-ankle speed in find_stride_frame and lead-wrist speed in
    wrist_lead_ms). Raw signal only - never fabricated."""
    n = len(pose_2d_frames)
    speeds = [None] * n
    for i in range(1, n - 1):
        kp_a, kp_b = pose_2d_frames[i - 1]["keypoints"], pose_2d_frames[i + 1]["keypoints"]
        if kp_a is None or kp_b is None:
            continue
        a, b = kp_a[keypoint_idx], kp_b[keypoint_idx]
        if a[2] <= 0.15 or b[2] <= 0.15:
            continue
        speeds[i] = dist(a[:2], b[:2]) / (2.0 / fps)
    return speeds


def find_extension_frame(knee_series, contact_frame, fps, n, search_s=2.0):
    """Extension = peak front-knee angle in a forward-only window from
    contact (the front leg keeps extending briefly after contact, confirmed
    on real data - e.g. Emily_C_AB1 (4)'s peak lands ~1.6s after contact, not
    at it). High confidence reuses the same 155deg threshold already
    calibrated against real film in pose3d_to_checklist.py's
    EXTENSION_THRESHOLDS (see EXTENSION_HIGH_CONF_DEG's own comment) - forced
    to low if the peak sits at the search window's own edge (still rising,
    not a real local peak, so the true peak may be later than this window
    reaches)."""
    i0, i1 = contact_frame, phase_search_window(contact_frame, fps, n, post_s=search_s)[1]
    candidates = [(i, knee_series[i]) for i in range(i0, i1 + 1) if knee_series[i] is not None]
    if not candidates:
        return {"frame": None, "time_s": None, "method": "peak front-knee angle in a "
                f"{search_s}s forward window from contact - no tracked knee-angle reading "
                "in that window", "confidence": None, "detail": {"reason": "no tracked frames"}}
    peak_i, peak_v = max(candidates, key=lambda t: t[1])
    at_edge = peak_i == i1
    confidence = "high" if (peak_v >= EXTENSION_HIGH_CONF_DEG and not at_edge) else "low"
    return {
        "frame": peak_i, "time_s": None,
        "method": f"argmax(front-knee angle) over a {search_s}s forward window from contact - "
                  f"confidence high only if peak >= {EXTENSION_HIGH_CONF_DEG} deg (same threshold "
                  "already calibrated against real film in pose3d_to_checklist.py's "
                  "EXTENSION_THRESHOLDS) and not sitting at the window's own edge",
        "confidence": confidence,
        "detail": {"knee_angle_deg": round(peak_v, 1), "extension_peak_at_window_edge": at_edge},
    }


def find_stride_frame(pose_2d_frames, fps, front_side, hip_px, contact_frame, n, search_s=2.5):
    """Stride/plant = last frame in a backward-only window from contact where
    front-ankle speed was sustained above STRIDE_SPEED_MIN_HIP_WIDTHS_PER_S
    for STRIDE_SUSTAIN_S worth of consecutive frames (a single-frame spike isn't
    trusted, same "don't trust one noisy signal frame" lesson find_contact_
    frame's own docstring already documents for the bat-waggle false
    positive). Threshold empirically set from real data across all 7 emily_c
    clips - see STRIDE_SPEED_MIN_HIP_WIDTHS_PER_S's own comment. Returns None
    with an explicit reason if no sustained motion exists in the window
    (confirmed this genuinely happens on real data - e.g. Emily_C_AB1 (3)'s
    front foot measured essentially static, <0.1px/frame, the whole window)
    rather than fabricating a plant frame."""
    if front_side is None or not hip_px:
        return {"frame": None, "time_s": None,
                "method": "front-ankle speed over a backward window from contact",
                "confidence": None, "detail": {"reason": "no lead-side/hip-scale reading"}}
    ankle_idx = L_ANKLE_2D if front_side == "l" else R_ANKLE_2D
    speeds_px = keypoint_speed_series(pose_2d_frames, fps, ankle_idx)
    i0, i1 = phase_search_window(contact_frame, fps, n, pre_s=search_s)[0], contact_frame

    sustain_frames = max(1, round(STRIDE_SUSTAIN_S * fps))
    threshold_px_s = STRIDE_SPEED_MIN_HIP_WIDTHS_PER_S * hip_px
    sustained_frames = []
    for i in range(i0, i1 + 1):
        if speeds_px[i] is not None and speeds_px[i] >= threshold_px_s:
            sustained_frames.append(i)
    # Keep only frames that are part of a run of >= sustain_frames consecutive
    # above-threshold frames - rejects an isolated jitter spike.
    plant_frame = None
    run_start = None
    for i in range(i0, i1 + 1):
        above = speeds_px[i] is not None and speeds_px[i] >= threshold_px_s
        if above:
            if run_start is None:
                run_start = i
            if i - run_start + 1 >= sustain_frames:
                plant_frame = i
        else:
            run_start = None
    if plant_frame is None:
        return {
            "frame": None, "time_s": None,
            "method": f"last frame of a >= {sustain_frames}-frame sustained run of "
                      f"front-ankle speed >= {STRIDE_SPEED_MIN_HIP_WIDTHS_PER_S} hip-widths/s, "
                      f"in a {search_s}s backward window from contact",
            "confidence": None,
            "detail": {"reason": "no sustained above-threshold front-ankle motion found in "
                                  "window - true plant may be earlier than this window reaches, "
                                  "not reported to avoid fabricating a timestamp"},
        }
    return {
        "frame": plant_frame, "time_s": None,
        "method": f"last frame of a >= {sustain_frames}-frame sustained run of "
                  f"front-ankle speed >= {STRIDE_SPEED_MIN_HIP_WIDTHS_PER_S} hip-widths/s, "
                  f"in a {search_s}s backward window from contact",
        "confidence": "low",  # never "high" - a real plant instant this pipeline can't verify
                              # against ground truth (no force-plate/foot-strike sensor exists)
        "detail": {"speed_hip_widths_per_s": round(speeds_px[plant_frame] / hip_px, 2)},
    }


def find_follow_through_frame(rotation_series, contact_frame, fps, n, search_s=3.0,
                               decay_sustain_s=5 / 30):
    """Follow-through start = first frame of a >= decay_sustain_frames
    sustained run of body-rotation activity under ROTATION_MIN_DEG, after
    contact, having been elevated first - the weakest-grounded of the 5 new
    phases (no direct "finish position" signal exists anywhere in this
    pipeline's data). A single-frame dip below the floor is NOT trusted on
    its own: real data showed rotation_activity_series can dip below
    ROTATION_MIN_DEG for one noisy frame well before the front leg finishes
    extending (confirmed by cross-checking against find_extension_frame's own
    output on Emily_C_AB1 (4) - a one-frame trigger fired at +0.17s while
    extension kept climbing through +1.6s), the same "don't trust a single
    signal frame" lesson find_contact_frame's own docstring already
    documents for the bat-waggle false positive. Confidence is capped at
    "low" always - even sustained, this is a decay-proxy, not a validated
    finish-position detector. Returns None with a reason if rotation never
    sustainably decays within the window (confirmed this happens on real
    data - e.g. Emily_C_AB1 (2) and (3) both stayed elevated or untracked
    through the full 3s window)."""
    decay_sustain_frames = max(1, round(decay_sustain_s * fps))
    i1 = phase_search_window(contact_frame, fps, n, post_s=search_s)[1]
    was_elevated = False
    decay_run_start = None
    for i in range(contact_frame, i1 + 1):
        v = rotation_series[i]
        if v is None:
            decay_run_start = None
            continue
        if v >= ROTATION_MIN_DEG:
            was_elevated = True
            decay_run_start = None
            continue
        if not was_elevated:
            continue
        if decay_run_start is None:
            decay_run_start = i
        if i - decay_run_start + 1 >= decay_sustain_frames:
            return {
                "frame": decay_run_start, "time_s": None,
                "method": f"first frame of a >= {decay_sustain_frames}-frame sustained run of "
                          f"body-rotation activity under {ROTATION_MIN_DEG} deg after contact, "
                          f"having been elevated first, in a {search_s}s forward window - no "
                          "direct finish-position signal exists, this is a decay proxy only",
                "confidence": "low",
                "detail": {"rotation_activity_deg": round(rotation_series[decay_run_start], 2)},
            }
    return {
        "frame": None, "time_s": None,
        "method": f"first frame of a >= {decay_sustain_frames}-frame sustained run of "
                  f"body-rotation activity under {ROTATION_MIN_DEG} deg after contact, having "
                  f"been elevated first, in a {search_s}s forward window",
        "confidence": None,
        "detail": {"reason": "rotation activity never sustainably decayed (or was never "
                              "tracked) within the window - not reported to avoid fabricating "
                              "a timestamp"},
    }


def find_load_frame(pose_2d_frames, front_side, contact_frame, fps, n, search_s=2.5):
    """Load = frame of maximum backward (away-from-contact-direction) lead-
    wrist retraction before sustained forward hand motion begins, in a short
    backward window from contact. Kept short deliberately (2.5s, not longer)
    - a longer window risks grabbing an unrelated earlier pitch/swing inside
    the same full at-bat clip (confirmed a real risk: overlay stills around
    t=30s in Emily_C_AB1 (4), well outside this window, show a DIFFERENT
    swing/foul already in progress). This is the most speculative of the 5
    new phases - no dedicated hand-tracking signal exists anywhere else in
    this pipeline, and real data showed the lead wrist moving essentially
    monotonically toward contact with no backward dip in every one of the 7
    real clips checked - expect this to return None on real data often, and
    ship that honestly rather than invent a retraction that isn't there."""
    if front_side is None:
        return {"frame": None, "time_s": None, "method": "lead-wrist retraction extremum in a "
                f"{search_s}s backward window from contact", "confidence": None,
                "detail": {"reason": "no lead-side reading"}}
    wrist_idx = L_WRIST_2D if front_side == "l" else R_WRIST_2D
    i0, i1 = phase_search_window(contact_frame, fps, n, pre_s=search_s)[0], contact_frame
    positions = []
    for i in range(i0, i1 + 1):
        kp = pose_2d_frames[i]["keypoints"]
        if kp is not None and kp[wrist_idx][2] > 0.15:
            positions.append((i, kp[wrist_idx][0]))
    if len(positions) < 3:
        return {"frame": None, "time_s": None, "method": "lead-wrist retraction extremum in a "
                f"{search_s}s backward window from contact", "confidence": None,
                "detail": {"reason": "insufficient tracked lead-wrist frames in window"}}
    # Net direction of travel toward contact (last position relative to
    # first) - the retraction point is the extremum AGAINST that direction,
    # i.e. the frame furthest "backward" before the hand commits forward.
    net_dx = positions[-1][1] - positions[0][1]
    if net_dx == 0:
        return {"frame": None, "time_s": None, "method": "lead-wrist retraction extremum in a "
                f"{search_s}s backward window from contact", "confidence": None,
                "detail": {"reason": "no net forward hand travel detected toward contact"}}
    extremum = min(positions, key=lambda t: t[1]) if net_dx > 0 else max(positions, key=lambda t: t[1])
    extremum_i, extremum_x = extremum
    # Only meaningful if the extremum isn't simply the first tracked frame
    # (that would just be "wherever tracking happened to start," not a real
    # retraction peak) and isn't the last frame (that would be motion
    # continuing toward contact, not away from it).
    if extremum_i in (positions[0][0], positions[-1][0]):
        return {
            "frame": None, "time_s": None,
            "method": f"lead-wrist retraction extremum in a {search_s}s backward window from "
                      "contact",
            "confidence": None,
            "detail": {"reason": "no backward retraction dip found - lead wrist moved "
                                  "essentially monotonically toward contact across the window"},
        }
    return {
        "frame": extremum_i, "time_s": None,
        "method": f"lead-wrist retraction extremum (furthest point against the net direction "
                  f"of travel toward contact) in a {search_s}s backward window from contact",
        "confidence": "low",  # never "high" - this signal has no independent cross-check
        "detail": {"wrist_x_px": round(extremum_x, 1)},
    }


def find_stance_frame(rotation_series, load_frame, stride_frame, contact_frame, fps, n,
                       search_s=3.0, quiet_run_s=5 / 30):
    """Stance = last frame of a sustained quiet run (rotation activity under
    ROTATION_MIN_DEG for >= quiet_run_frames consecutive frames) immediately
    before whichever of Load/Stride starts the swing, in a backward window
    from contact. This is a state-boundary heuristic, not a true detected
    instant - it is structurally indistinguishable from mid-clip dead time,
    a bat waggle, or an earlier pitch's stance, so confidence is always "low"
    when found at all, documented here rather than silently implied.

    Confirmed a real failure mode by extracting the actual detected frame as
    a still image (not just trusting the numbers): on Emily_C_AB1 (1) (a
    high-confidence CONTACT clip), the "quiet" frame this function found
    ~1.9s before contact visually shows the batter already mid-swing
    (post-stride, bat already through the zone toward a different pitch/
    contact instant earlier in this same clip) - NOT a genuine pre-pitch
    stance. Angular-velocity floors alone can't distinguish "at rest" from
    "a brief lull between two rapid rotations," which is exactly why this
    stays capped at "low" unconditionally rather than ever being trusted as
    "high" - a coach-facing UI must not present this as a reliable marker."""
    quiet_run_frames = max(1, round(quiet_run_s * fps))
    swing_start = min([f for f in (load_frame, stride_frame) if f is not None], default=contact_frame)
    i0 = phase_search_window(contact_frame, fps, n, pre_s=search_s)[0]
    run_len = 0
    last_quiet_frame = None
    for i in range(i0, swing_start + 1):
        v = rotation_series[i]
        quiet = v is not None and v < ROTATION_MIN_DEG
        if quiet:
            run_len += 1
            if run_len >= quiet_run_frames:
                last_quiet_frame = i
        else:
            run_len = 0
    if last_quiet_frame is None:
        return {
            "frame": None, "time_s": None,
            "method": f"last frame of a >= {quiet_run_frames}-frame quiet run (rotation activity "
                      f"< {ROTATION_MIN_DEG} deg) before swing onset, in a {search_s}s backward "
                      "window from contact",
            "confidence": None,
            "detail": {"reason": "no sustained quiet run found before swing onset in window"},
        }
    return {
        "frame": last_quiet_frame, "time_s": None,
        "method": f"last frame of a >= {quiet_run_frames}-frame quiet run (rotation activity < "
                  f"{ROTATION_MIN_DEG} deg) before swing onset, in a {search_s}s backward window "
                  "from contact - a state-boundary heuristic, not a true detected instant; "
                  "structurally indistinguishable from mid-clip dead time or an earlier pitch's "
                  "stance",
        "confidence": "low",
        "detail": {},
    }


# --- Movement-pattern flags (new) - each reuses signals already computed
# above rather than adding new pose/video processing. All are single-number
# snapshots at or around contact, not validated kinematic-sequence
# measurements - each carries its own honest confidence/limitation note,
# same bar as the phase detectors above. ---

def hip_midpoint_series(pose_2d_frames):
    """Per-frame 2D pixel midpoint of L/R hip keypoints (same 0.15 confidence
    floor body_scale_px already uses), None where either side is untracked."""
    out = []
    for f in pose_2d_frames:
        kp = f["keypoints"]
        if kp is None:
            out.append(None)
            continue
        lh, rh = kp[L_HIP_2D], kp[R_HIP_2D]
        out.append(((lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2) if lh[2] > 0.15 and rh[2] > 0.15 else None)
    return out


def lateral_sway_hip_widths(pose_2d_frames, hip_px, stance_frame, contact_frame):
    """Net 2D image-plane-x drift of the hip midpoint from stance to contact,
    in hip-widths - how far the pelvis drifted sideways during load/stride
    instead of staying put, a real fault coaches look for ('sway'). CAUTION:
    2D image-plane x only - conflates true lateral sway with any toward/away-
    from-camera depth change for a non-side-on camera angle (same single-
    camera, no-stereo-calibration caveat every other body-relative number in
    this file already carries). Returns None if stance_frame is unknown
    (common - stance is the least reliable of the 5 phase detectors, see
    find_stance_frame's own docstring) rather than falling back to the clip's
    first tracked frame, which risks being an EARLIER pitch's stance in a
    full at-bat clip (same caution the legacy `stride` field's own note
    already documents)."""
    if not hip_px or stance_frame is None:
        return None
    mids = hip_midpoint_series(pose_2d_frames)
    a, b = mids[stance_frame], mids[contact_frame]
    if a is None or b is None:
        return None
    return round((b[0] - a[0]) / hip_px, 3)


def classify_rotation_pattern(knee_pct, rot_pct):
    """Compares each signal's OWN clip-relative percentile AT THE CONTACT
    INSTANT (already computed by find_contact_frame for its own argmax score
    - not raw units, which aren't comparable). 'knee-dominant' if front-knee
    extension sits much closer to its own clip-peak than body rotation does
    to its own; 'hip-rotation-dominant' the reverse; 'balanced' within
    KNEE_DOMINANT_MARGIN. A relative-emphasis snapshot AT CONTACT ONLY, not a
    whole-swing sequencing analysis."""
    if knee_pct is None or rot_pct is None:
        return None, {"reason": "missing knee or rotation percentile at contact"}
    diff = knee_pct - rot_pct
    if abs(diff) < KNEE_DOMINANT_MARGIN:
        pattern = "balanced"
    elif diff > 0:
        pattern = "knee-dominant"
    else:
        pattern = "hip-rotation-dominant"
    return pattern, {
        "knee_extension_percentile_at_contact": round(knee_pct, 3),
        "rotation_activity_percentile_at_contact": round(rot_pct, 3),
        "margin": KNEE_DOMINANT_MARGIN,
    }


def find_onset_frame(series, i0, i1, frac=0.5):
    """First frame in [i0,i1] at which `series`'s own min-max-normalized
    value, normalized WITHIN this window only (a fair self-relative floor,
    not a new unvalidated absolute magnitude threshold), first reaches
    >= frac."""
    window = series[i0:i1 + 1]
    norm = _minmax_norm(window)
    for j, v in enumerate(norm):
        if v is not None and v >= frac:
            return i0 + j
    return None


def wrist_lead_ms(pose_2d_frames, fps, front_side, contact_frame, n, rotation_series):
    """Compares onset timing of lead-wrist speed vs. body-rotation activity,
    in the same bounded backward window find_load_frame already uses (2.5s -
    see WRIST_LEAD_SEARCH_S). Positive = lead-wrist speed crossed its own
    onset threshold before body rotation did ('hands start the swing');
    negative = rotation led ('hips/trunk start the swing'). A coarse
    single-number proxy, NOT a validated kinematic-sequence measurement (real
    biomechanics research tracks angular velocity peaks across pelvis->
    trunk->arm->bat; this pipeline only has 2D wrist position and a 2D
    shoulder-line rotation proxy). No independent cross-check exists -
    confidence always "low", same as find_load_frame's own wrist signal
    whose window this reuses."""
    if front_side is None:
        return None, {"reason": "no lead-side reading"}
    wrist_idx = L_WRIST_2D if front_side == "l" else R_WRIST_2D
    i0 = phase_search_window(contact_frame, fps, n, pre_s=WRIST_LEAD_SEARCH_S)[0]
    i1 = contact_frame
    wrist_speed = keypoint_speed_series(pose_2d_frames, fps, wrist_idx)
    wrist_onset = find_onset_frame(wrist_speed, i0, i1)
    rotation_onset = find_onset_frame(rotation_series, i0, i1)
    if wrist_onset is None or rotation_onset is None:
        return None, {"reason": "no confident onset for wrist speed and/or rotation activity "
                                 "in window"}
    return round((rotation_onset - wrist_onset) / fps * 1000, 1), {
        "wrist_onset_frame": wrist_onset,
        "rotation_onset_frame": rotation_onset,
        "search_window_s": WRIST_LEAD_SEARCH_S,
    }


def run(clip_dir):
    clip_dir = pathlib.Path(clip_dir)
    pose_2d = json.loads((clip_dir / "pose_2d.json").read_text())
    pose_3d = json.loads((clip_dir / "pose_3d.json").read_text())
    bat_path = json.loads((clip_dir / "bat_path.json").read_text())

    fps = pose_2d["meta"]["fps"]
    p2_frames = pose_2d["frames"]
    p3_frames = pose_3d["frames"]
    bat_frames = bat_path["frames"]
    n = len(p2_frames)

    shoulder_px, hip_px = body_scale_px(p2_frames)
    speeds = bat_speeds(bat_frames, fps)
    knee_series = knee_extension_series(p3_frames)
    rotation_series = rotation_activity_series(p3_frames, fps)
    contact_frame, joint_score, speed_norm, knee_norm, rot_norm = find_contact_frame(
        speeds, knee_series, rotation_series)

    result = {"clip": clip_dir.name, "n_frames": n, "fps": fps}

    if contact_frame is None:
        # detect_2d.py's own bat_evidence stat (see its build_batter_track)
        # distinguishes two very different reasons contact can't be found: a
        # generically hard/untrackable clip, vs. a person who tracks CLEANLY
        # but whose bat almost never resolves - confirmed on a real clip to
        # mean the camera was positioned along the baseline instead of
        # behind the backstop (the batter is small/distant in every frame,
        # so the bat rarely has enough pixels to detect, even though the
        # person themselves tracks fine). Worth a specific, actionable
        # message rather than the generic one, since this is a filming
        # problem a coach can actually fix on the next upload.
        bat_evidence = bat_path.get("meta", {}).get("bat_evidence") or {}
        track_frames = bat_evidence.get("track_frames", 0)
        bat_evidence_frames = bat_evidence.get("bat_evidence_frames", 0)
        likely_framing_issue = (
            n > 0 and track_frames / n >= 0.5
            and bat_evidence_frames <= max(5, round(0.02 * track_frames))
        )
        if likely_framing_issue:
            result["error"] = (
                f"A batter tracked cleanly through this clip ({track_frames}/{n} frames), but the "
                f"bat itself was almost never confidently detected ({bat_evidence_frames} frame(s) "
                "with real bat-holding evidence) - cannot locate contact. This usually means the "
                "camera wasn't positioned behind the backstop, facing the batter (e.g. filmed from "
                "along the baseline instead) - the batter is visible, but too small/distant for the "
                "bat itself to be reliably detected. Try re-filming from directly behind home plate."
            )
        else:
            result["error"] = ("No frame has a tracked bat-speed reading, a knee-angle reading, "
                                "AND a body-rotation reading all at once - cannot locate contact.")
        (clip_dir / "metrics.json").write_text(json.dumps(result, indent=2))
        print(f"[metrics] {result['error']}")
        return result

    contact_t = p2_frames[contact_frame]["time_s"]
    # Confidence: contact must be near the top of bat-speed and knee-extension
    # individually (not just a decent joint compromise), AND the body must be
    # ACTIVELY rotating in absolute terms. Rotation deliberately uses an
    # absolute degree floor, not a percentile like the other two: peak
    # angular velocity often lands slightly after contact (rotation keeps
    # accelerating into follow-through), so requiring rotation to be near
    # THIS CLIP'S OWN peak would wrongly penalize a real, correctly-detected
    # contact frame just because some other frame later in the follow-through
    # happened to rotate even faster. What actually distinguishes a real
    # swing from a static bat-waggle (the false positive this was built to
    # catch) is whether the body is rotating AT ALL, which an absolute
    # threshold checks directly - a genuine waggle measured at ~0deg/window,
    # a real swing-in-progress at 10+ deg/window.
    rotation_ok = (rotation_series[contact_frame] is not None
                   and rotation_series[contact_frame] >= ROTATION_MIN_DEG)
    high_conf = (speed_norm[contact_frame] >= 0.7 and knee_norm[contact_frame] >= 0.7
                 and rotation_ok)

    result["contact"] = {
        "frame": contact_frame,
        "time_s": round(contact_t, 4),
        "method": "argmax(bat-tip speed norm * front-knee-extension norm * body-rotation-"
                  "activity norm) - see metrics.py module docstring for why no single signal "
                  "is trusted alone over a full at-bat clip",
        "bat_speed_percentile_at_contact": round(speed_norm[contact_frame], 3),
        "knee_extension_percentile_at_contact": round(knee_norm[contact_frame], 3),
        "rotation_activity_percentile_at_contact": round(rot_norm[contact_frame], 3),
        "rotation_activity_deg_at_contact": round(rotation_series[contact_frame], 2)
            if rotation_series[contact_frame] is not None else None,
        "rotation_activity_min_deg_required": ROTATION_MIN_DEG,
        "confidence": "high" if high_conf else "low",
    }

    # Max bat speed near contact (body-relative units, not a fabricated mph
    # figure - see module docstring). Restricted to a window around the
    # identified contact frame, not the whole clip: a whole-at-bat clip's
    # global max is exactly as vulnerable to a stray detection glitch during
    # dead time as the contact-frame search above was before this was fixed.
    window = int(round(ALIGNMENT_TOLERANCE_S * 2 * fps))
    i0, i1 = max(contact_frame - window, 0), min(contact_frame + window, n - 1)
    window_speeds = [s for s in speeds[i0:i1 + 1] if s is not None]
    max_speed_px = max(window_speeds) if window_speeds else None
    max_speed_frame = None
    if max_speed_px is not None:
        max_speed_frame = i0 + speeds[i0:i1 + 1].index(max_speed_px)
    result["max_bat_speed"] = {
        "value": round(max_speed_px / shoulder_px, 3) if (max_speed_px and shoulder_px) else None,
        "unit": "shoulder-widths/sec (body-relative; no camera calibration exists for this "
                "footage, so an absolute mph figure would be fabricated precision)",
        "search_window_s": round(window / fps, 2),
        "frame": max_speed_frame,
    }

    result["attack_angle_at_contact_deg"] = attack_angle_at(bat_frames, fps, contact_frame)

    contact_angles = p3_frames[contact_frame]["angles"]
    result["hip_shoulder_separation_at_contact_deg"] = contact_angles["hip_shoulder_separation_deg"]
    result["torso_tilt_at_contact_deg"] = contact_angles["torso_tilt_from_vertical_deg"]
    # .get(), not direct indexing: pelvis_tilt_from_level_deg is a new
    # lift_3d.py field - already-processed clips' pose_3d.json won't have it
    # until the backfill script re-derives angles from their already-stored
    # joints (no VideoPose3D re-run needed), so this must degrade to None
    # rather than KeyError on old data.
    result["pelvis_tilt_at_contact_deg"] = contact_angles.get("pelvis_tilt_from_level_deg")

    front = front_side_at(p2_frames, fps, contact_frame)
    # Lead (front) arm = same side as the front leg for a normal open/closed
    # stance swing (front arm is the one nearer the pitcher, same side as the
    # front foot) - documented heuristic, not a certainty.
    if front == "l":
        lead_elbow = contact_angles["l_elbow_angle_deg"]
        lead_knee = contact_angles["l_knee_angle_deg"]
    elif front == "r":
        lead_elbow = contact_angles["r_elbow_angle_deg"]
        lead_knee = contact_angles["r_knee_angle_deg"]
    else:
        lead_elbow = lead_knee = None
    result["lead_side_guess"] = front
    result["lead_side_method"] = ("whichever ankle sits lower in-frame (closer to camera) at "
                                   "contact - a heuristic, not known batter handedness/orientation")
    result["lead_elbow_angle_at_contact_deg"] = lead_elbow
    result["front_knee_angle_at_contact_deg"] = lead_knee
    result["l_elbow_angle_at_contact_deg"] = contact_angles["l_elbow_angle_deg"]
    result["r_elbow_angle_at_contact_deg"] = contact_angles["r_elbow_angle_deg"]

    # Stride: front-ankle displacement from the first tracked frame of this
    # clip to contact - reports what was actually measured (whole-clip
    # displacement), not an auto-detected "load phase" this pipeline doesn't
    # implement.
    if front is not None and hip_px:
        ankle_idx = L_ANKLE_2D if front == "l" else R_ANKLE_2D
        start_pt = None
        for f in p2_frames:
            if f["keypoints"] is not None and f["keypoints"][ankle_idx][2] > 0.15:
                start_pt = f["keypoints"][ankle_idx][:2]
                break
        end_kp = p2_frames[contact_frame]["keypoints"]
        end_pt = end_kp[ankle_idx][:2] if end_kp is not None else None
        if start_pt and end_pt:
            dx, dy = end_pt[0] - start_pt[0], -(end_pt[1] - start_pt[1])
            result["stride"] = {
                "length_hip_widths": round(math.hypot(dx, dy) / hip_px, 3),
                "direction_deg": round(math.degrees(math.atan2(dy, dx)), 1),
                "note": "front-ankle displacement from this clip's first tracked frame to "
                        "contact, in hip-widths; direction 0=camera-right, 90=toward camera "
                        "(image plane, +up). CAUTION: if this clip covers a full at-bat with "
                        "more than one pitch, 'first tracked frame' may be an earlier pitch's "
                        "stance, not this swing's load - this is whole-clip displacement, not "
                        "an auto-detected load-phase start.",
            }
        else:
            result["stride"] = None
    else:
        result["stride"] = None

    # New (unlike the legacy whole-clip `stride` field above): a bounded,
    # per-swing detector for each of the 5 phases the old field's own caveat
    # says this pipeline "doesn't implement" - each searches a window
    # relative to contact (never the whole clip) and honestly returns
    # frame=None with a documented reason rather than a fabricated timestamp
    # when the signal doesn't support one. See each find_*_frame()'s own
    # docstring for the specific method and its confidence ceiling.
    extension = find_extension_frame(knee_series, contact_frame, fps, n)
    stride_phase = find_stride_frame(p2_frames, fps, front, hip_px, contact_frame, n)
    follow_through = find_follow_through_frame(rotation_series, contact_frame, fps, n)
    load = find_load_frame(p2_frames, front, contact_frame, fps, n)
    stance = find_stance_frame(rotation_series, load["frame"], stride_phase["frame"],
                                contact_frame, fps, n)

    for phase in (extension, stride_phase, follow_through, load, stance):
        if phase["frame"] is not None:
            phase["time_s"] = round(p2_frames[phase["frame"]]["time_s"], 4)

    # NOTE on ordering: stance/load/stride/contact are guaranteed non-
    # decreasing when all present (each searches backward from the previous
    # anchor). extension and follow_through are NOT guaranteed to order
    # against each other, and confirmed NOT to on real data (Emily_C_AB1
    # (4): follow_through at +0.29s, extension at +1.6s) - they track
    # different signals (knee angle vs. rotational deceleration) with no
    # fixed biomechanical sequence between them, not a detection bug.
    result["phases"] = {
        "stance": stance,
        "load": load,
        "stride": stride_phase,
        "contact": result["contact"],
        "extension": extension,
        "follow_through": follow_through,
    }

    # Automated movement-pattern flags - each reuses signals already computed
    # above, none add new pose/video processing. See each function's own
    # docstring for method + honest confidence ceiling.
    sway = lateral_sway_hip_widths(p2_frames, hip_px, stance["frame"], contact_frame)
    sway_detail = {} if sway is not None else {"reason": "stance frame not found"}
    rotation_pattern, rotation_pattern_detail = classify_rotation_pattern(
        result["contact"]["knee_extension_percentile_at_contact"],
        result["contact"]["rotation_activity_percentile_at_contact"],
    )
    wrist_ms, wrist_detail = wrist_lead_ms(p2_frames, fps, front, contact_frame, n, rotation_series)

    result["movement_flags"] = {
        "lateral_sway": {
            "value": sway,
            "unit": "hip-widths (2D image-plane x, not stereo-calibrated - see "
                    "lateral_sway_hip_widths docstring)",
            "confidence": stance["confidence"] if sway is not None else None,
            "method": "net 2D hip-midpoint x-drift from stance to contact, in hip-widths",
            "detail": sway_detail,
        },
        "rotation_pattern": {
            "value": rotation_pattern,
            "confidence": result["contact"]["confidence"] if rotation_pattern is not None else None,
            "method": f"compares knee-extension and body-rotation percentiles at contact (each "
                      f"clip-relative, own min-max norm) - within {KNEE_DOMINANT_MARGIN} counts "
                      "as balanced",
            "detail": rotation_pattern_detail,
        },
        "wrist_lead_ms": {
            "value": wrist_ms,
            "unit": "milliseconds (positive = hands led rotation onset, negative = rotation led)",
            "confidence": "low" if wrist_ms is not None else None,
            "method": "compares onset frame (first crossing 50% of its own window-local range) "
                      "of lead-wrist speed vs. body-rotation activity, in the same backward "
                      "window find_load_frame uses",
            "detail": wrist_detail,
        },
    }

    out_path = clip_dir / "metrics.json"
    out_path.write_text(json.dumps(result, indent=2))
    print(f"[metrics] contact at frame {contact_frame} ({contact_t:.3f}s), "
          f"confidence={result['contact']['confidence']}")
    print(f"[metrics] wrote {out_path}")
    return result


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python metrics.py <clip_dir>")
        sys.exit(1)
    run(sys.argv[1])
