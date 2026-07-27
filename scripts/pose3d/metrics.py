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

Usage: python metrics.py <clip_dir>
  (expects pose_2d.json, pose_3d.json, bat_path.json already in clip_dir)
"""
import sys
import json
import math
import pathlib

ALIGNMENT_TOLERANCE_S = 0.5

L_ANKLE_2D, R_ANKLE_2D = 15, 16
L_HIP_2D, R_HIP_2D = 11, 12
L_SHOULDER_2D, R_SHOULDER_2D = 5, 6


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


def find_contact_frame(speeds, knee_series):
    """Full at-bat clips (this project's slow-mo footage covers an entire
    at-bat, per scripts/extract_frames.ps1's own docstring) are mostly NOT the
    swing - waiting on pitches, resets, walk-up. The old MediaPipe pipeline
    sidestepped this by having a human hand-pick a contact window per clip
    (windows.json). This pipeline auto-detects instead, which means picking
    the single global peak of EITHER signal alone is unsafe: a bat sitting
    still between pitches can still produce a one-frame detection jitter that
    reads as "fast," and a batter simply standing can hit full knee
    extension outside the swing. Requiring BOTH signals to be elevated AT
    THE SAME FRAME is what actually distinguishes contact from noise anywhere
    else in the clip - dead time essentially never has a fast bat and a
    near-locked-out front knee at once. Contact = argmax(bat_speed_norm *
    knee_angle_norm) over frames where both are present.
    """
    speed_norm = _minmax_norm(speeds)
    knee_norm = _minmax_norm(knee_series)
    best_i, best_score = None, -1.0
    for i in range(len(speed_norm)):
        if speed_norm[i] is None or knee_norm[i] is None:
            continue
        score = speed_norm[i] * knee_norm[i]
        if score > best_score:
            best_i, best_score = i, score
    return best_i, best_score, speed_norm, knee_norm


def front_side_at(pose_2d_frames, idx):
    """'l' or 'r' - whichever ankle sits lower in frame (closer to camera) at
    the given frame index, falling back to nearby frames if untracked."""
    for j in range(idx, max(idx - 10, -1), -1):
        kp = pose_2d_frames[j]["keypoints"]
        if kp is None:
            continue
        l_ank, r_ank = kp[L_ANKLE_2D], kp[R_ANKLE_2D]
        if l_ank[2] > 0.15 and r_ank[2] > 0.15:
            return "l" if l_ank[1] > r_ank[1] else "r"
    return None


def attack_angle_at(bat_frames, fps, idx, half_window=2):
    """Degrees, +up/-down, of the bat tip's velocity direction averaged over a
    small window centered on idx. Image y grows downward, so dy is negated to
    report "upward swing" as positive, matching normal attack-angle convention."""
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
    contact_frame, joint_score, speed_norm, knee_norm = find_contact_frame(speeds, knee_series)

    result = {"clip": clip_dir.name, "n_frames": n, "fps": fps}

    if contact_frame is None:
        result["error"] = ("No frame has both a tracked bat-speed reading and a knee-angle "
                            "reading - cannot locate contact.")
        (clip_dir / "metrics.json").write_text(json.dumps(result, indent=2))
        print(f"[metrics] {result['error']}")
        return result

    contact_t = p2_frames[contact_frame]["time_s"]
    # Confidence: contact is only trustworthy if THIS frame is genuinely near
    # the top of both signals individually, not just a decent joint compromise
    # - e.g. a frame with knee_norm=0.95 and speed_norm=0.85 is a real swing
    # instant; a frame with knee_norm=0.99 and speed_norm=0.4 is more likely a
    # tall-standing moment with an incidental bat wobble.
    high_conf = speed_norm[contact_frame] >= 0.7 and knee_norm[contact_frame] >= 0.7

    result["contact"] = {
        "frame": contact_frame,
        "time_s": round(contact_t, 4),
        "method": "argmax(bat-tip speed norm * front-knee-extension norm) - see metrics.py "
                  "module docstring for why neither signal alone is trusted over a full "
                  "at-bat clip",
        "bat_speed_percentile_at_contact": round(speed_norm[contact_frame], 3),
        "knee_extension_percentile_at_contact": round(knee_norm[contact_frame], 3),
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

    front = front_side_at(p2_frames, contact_frame)
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
