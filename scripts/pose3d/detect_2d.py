"""
Stage 1 of the pose3d pipeline: person pose + bat detection on a single clip.

Detector choice (per the project spec's own "graceful degradation" clause -
document, don't silently fall back to plain MediaPipe): the spec's first
choice was RTMDet+RTMPose (MMPose/OpenMMLab). That stack was attempted in
this environment and is NOT installable here: `mmcv`'s compiled ops have no
prebuilt wheel for this machine's torch 2.11.0+cu128 build (OpenMMLab's wheel
matrix lags bleeding-edge PyTorch releases), and building it from source
requires a local MSVC + CUDA Toolkit compiler chain that isn't present
(no cl.exe, no nvcc). Ultralytics YOLO11-pose is substituted: it's a
different, actively maintained, GPU-accelerated top-down detector from the
same modern toolkit family - not a reversion to the old MediaPipe path (that
stays available, unused by default, via --legacy-mediapipe in the main
pipeline script only).

What this stage does, per frame:
  1. YOLO11-pose -> all detected people + COCO-17 2D keypoints w/ confidence.
  2. Batter selection: build a persistent track per detected person for the
     whole clip (greedy nearest-centroid matching, gated), then pick whichever
     track has the strongest cumulative evidence of holding the bat (a wrist
     near a bat detection, aggregated across every frame that track appears
     in - see build_batter_track). Two simpler heuristics were tried and
     failed on this footage's behind-the-backstop framing: "largest bbox"
     (the umpire/catcher sit closer to the camera and can look bigger than
     the batter) and "bat-proximity at one seed frame" (a single spurious
     detection near the catcher was enough to seed the whole clip wrong).
     Aggregating evidence across the whole clip per track is what actually
     holds up - confirmed by re-inspecting the overlay QA video after each
     fix.
  3. YOLOv8 (COCO class 34 = "baseball bat") -> bat bounding boxes, tracked
     across frames with Ultralytics' built-in ByteTrack (`model.track(...)`)
     for temporal continuity; bat tip/knob estimated from the box geometry
     relative to the batter's tracked hands.
  4. One-Euro filtering on every keypoint (x, y independently) and on the
     bat tip/knob, using real elapsed video time as the filter clock.

Output: pose_2d.json (COCO-17, batter only, per frame) and bat_path.json
(tip/knob per frame, nulls where no confident detection).

Usage: python detect_2d.py <video_path> <out_dir>
"""
import sys
import json
import pathlib

import cv2
import numpy as np
from ultralytics import YOLO

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from one_euro_filter import PointFilter2D

MODELS_DIR = pathlib.Path(__file__).parent.parent / "models"
POSE_MODEL = MODELS_DIR / "yolo11m-pose.pt"
DET_MODEL = MODELS_DIR / "yolov8m.pt"
BAT_CLASS_ID = 34  # COCO: "baseball bat"

# COCO-17 keypoint indices (Ultralytics' pose output order - same as VideoPose3D's
# expected 2D input order for the detectron_coco checkpoint, confirmed against
# VideoPose3D_src/data/prepare_data_2d_custom.py: raw COCO order, no reordering).
NOSE = 0
L_EYE, R_EYE = 1, 2
L_EAR, R_EAR = 3, 4
L_SHOULDER, R_SHOULDER = 5, 6
L_ELBOW, R_ELBOW = 7, 8
L_WRIST, R_WRIST = 9, 10
L_HIP, R_HIP = 11, 12
L_KNEE, R_KNEE = 13, 14
L_ANKLE, R_ANKLE = 15, 16
NUM_KP = 17

# How far (as a fraction of frame width) the batter's tracked centroid may
# jump between frames and still count as the same person. Same principle as
# the earlier MediaPipe-era batter tracker (BATTER_SEED/TRACK_GATE in
# render_real_overlay.py) - re-derived here since this detector's box format
# and confidence scale differ.
TRACK_GATE_FRAC = 0.18


def bbox_from_kps(kps, conf, min_conf=0.15):
    xs = [x for (x, y), c in zip(kps, conf) if c >= min_conf]
    ys = [y for (x, y), c in zip(kps, conf) if c >= min_conf]
    if len(xs) < 4:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def centroid(box):
    x0, y0, x1, y1 = box
    return ((x0 + x1) / 2, (y0 + y1) / 2)


MIN_TRACK_LEN = 15  # frames - ignore very short spurious tracks when picking the batter
BAT_HOLD_GATE_FRAC = 0.15  # wrist-to-bat-centroid distance, as a fraction of frame width


def build_person_tracks(frames_people, frame_w):
    """Greedy multi-object tracking across the whole clip: every detected
    person in every frame gets assigned to a persistent track by
    nearest-centroid match (gated), or starts a new track if nothing matches.
    Unlike single-frame seeding, this doesn't bet the whole clip's batter
    identity on one frame's local ambiguity - a batter/catcher/umpire mixup
    caused by one confusing frame just produces one wrong track among several,
    settled by evidence in build_batter_track below instead of being locked in
    immediately.

    Returns a dict: track_id -> {frame_idx: (kps, conf)}.
    """
    gate = TRACK_GATE_FRAC * frame_w
    tracks = {}
    active = {}  # track_id -> (last_frame_idx, last_centroid)
    next_id = 0

    for i, people in enumerate(frames_people):
        if not people:
            continue
        boxes = [bbox_from_kps(kps, conf) for kps, conf in people]
        used_tracks = set()
        # Match largest/most-complete detections first so ambiguous overlaps
        # resolve in favor of the more confidently-detected person.
        order = sorted(range(len(people)), key=lambda j: -(len(people[j][0])))
        for j in order:
            b = boxes[j]
            if b is None:
                continue
            c = centroid(b)
            best_tid, best_d = None, None
            for tid, (last_i, last_c) in active.items():
                if tid in used_tracks or i - last_i > 8:
                    continue
                d = np.hypot(c[0] - last_c[0], c[1] - last_c[1])
                if d <= gate and (best_d is None or d < best_d):
                    best_tid, best_d = tid, d
            if best_tid is None:
                best_tid = next_id
                next_id += 1
                tracks[best_tid] = {}
            tracks[best_tid][i] = people[j]
            active[best_tid] = (i, c)
            used_tracks.add(best_tid)

    return tracks


def build_batter_track(tracks, bat_frames, frame_w):
    """Pick whichever track has the strongest cumulative evidence of holding
    the bat - a wrist within BAT_HOLD_GATE_FRAC of a bat detection - across
    the WHOLE clip, not just one seed frame.

    This replaces two earlier, both-wrong approaches (kept only in git
    history): "largest bbox" (fails on this behind-the-backstop framing,
    where the umpire/catcher sit closer to the camera than the batter and can
    have a bigger apparent bbox - confirmed by an overlay QA video showing the
    skeleton locked onto the umpire for an entire clip) and "bat-proximity at
    the first matching frame" (still fails - a single frame's spurious bat
    detection near the catcher's glove was enough to seed the whole clip onto
    the catcher). Aggregating bat-proximity evidence over every frame, per
    track, is robust to either failure mode: a wrong track would need to look
    like the bat-holder consistently, not just once.
    """
    gate = BAT_HOLD_GATE_FRAC * frame_w
    scores = {tid: 0 for tid in tracks}
    for tid, frames in tracks.items():
        if len(frames) < MIN_TRACK_LEN:
            continue
        for i, (kps, conf) in frames.items():
            bats_here = bat_frames[i] if i < len(bat_frames) else []
            if not bats_here:
                continue
            bat_centroids = [centroid(box) for box, c, t in bats_here if c >= 0.3]
            for idx in (L_WRIST, R_WRIST):
                if conf[idx] < 0.15:
                    continue
                wx, wy = kps[idx]
                if any(np.hypot(wx - bx, wy - by) <= gate for bx, by in bat_centroids):
                    scores[tid] += 1
                    break

    eligible = {tid: s for tid, s in scores.items() if len(tracks[tid]) >= MIN_TRACK_LEN}
    if not eligible or max(eligible.values()) == 0:
        # No track shows consistent bat-holding evidence at all - fall back to
        # the single longest track (most-consistently-detected person is a
        # reasonable last resort, clearly logged rather than silently trusted).
        print("[detect_2d] WARNING: no track shows consistent bat-holding evidence - "
              "falling back to the longest-tracked person (may not be the batter)")
        return max(tracks, key=lambda tid: len(tracks[tid]))

    best_tid = max(eligible, key=eligible.get)
    print(f"[detect_2d] batter track selected: id={best_tid}, "
          f"{len(tracks[best_tid])} frames tracked, "
          f"bat-holding evidence in {scores[best_tid]} frames")
    return best_tid


def select_batter_track(frames_people, frame_w, frame_h, bat_frames=None):
    """frames_people[i] = list of (kps[17,2], conf[17]) detections in frame i.
    bat_frames[i] = list of (box, conf, track_id) bat detections in frame i.

    Returns a list, one entry per frame, of the chosen person's (kps, conf) or
    None if nobody plausible was found in that frame. See build_batter_track
    for how the batter identity is picked.
    """
    tracks = build_person_tracks(frames_people, frame_w)
    if not tracks:
        return [None] * len(frames_people)

    batter_tid = build_batter_track(tracks, bat_frames or [], frame_w)
    batter_frames = tracks[batter_tid]

    chosen = [None] * len(frames_people)
    for i, entry in batter_frames.items():
        chosen[i] = entry
    return chosen


def batter_hand_positions(chosen_frame):
    """Return (list of wrist points present) for gating which bat detection is 'held'."""
    if chosen_frame is None:
        return []
    kps, conf = chosen_frame
    pts = []
    for idx in (L_WRIST, R_WRIST):
        if conf[idx] >= 0.15:
            pts.append(tuple(kps[idx]))
    return pts


MIN_BAT_CONF_ACQUIRE = 0.35  # bar to START trusting a bat track
MIN_BAT_CONF_CONTINUE = 0.12  # bar to keep trusting an already-locked track through a dip


def select_bat_box(bat_boxes, hand_pts, max_dist, locked_track_id):
    """Pick the bat detection nearest a tracked wrist, preferring continuity of
    ByteTrack's own track_id over re-picking "nearest to hand" from scratch
    every frame. Re-picking from scratch each frame (the original approach)
    defeats the point of tracking: a single low-confidence false-positive
    detection (e.g. a shadow or the catcher's mitt momentarily read as "bat")
    that happens to fall within the hand-distance gate gets accepted as truth,
    producing a one-frame position jump that reads as an impossible bat-speed
    spike once finite-differenced. Locking onto a track and only re-acquiring
    when it's actually lost keeps a single glitchy detection from hijacking
    the whole path.

    Returns (chosen_detection_or_None, new_locked_track_id).
    """
    if not bat_boxes or not hand_pts:
        return None, None

    if locked_track_id is not None:
        for box, conf, track_id in bat_boxes:
            if track_id == locked_track_id and conf >= MIN_BAT_CONF_CONTINUE:
                cx, cy = centroid(box)
                d = min(np.hypot(cx - hx, cy - hy) for hx, hy in hand_pts)
                if d <= max_dist:
                    return (box, conf, track_id), track_id
        # Locked track vanished or drifted out of gate this frame - fall through
        # to re-acquisition rather than instantly trusting a different track.

    best, best_d = None, None
    for box, conf, track_id in bat_boxes:
        if conf < MIN_BAT_CONF_ACQUIRE:
            continue
        cx, cy = centroid(box)
        d = min(np.hypot(cx - hx, cy - hy) for hx, hy in hand_pts)
        if d <= max_dist and (best_d is None or d < best_d):
            best, best_d = (box, conf, track_id), d
    return (best, best[2]) if best is not None else (None, None)


def bat_tip_and_knob(box, hand_pts):
    """Approximate barrel-tip / knob endpoints from a bat bbox + which end is
    nearer the batter's hands (knob is held, tip is the far end of the long
    axis of the box)."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    # Long axis of the box approximates the bat's shaft direction.
    if w >= h:
        p_a, p_b = (x0, (y0 + y1) / 2), (x1, (y0 + y1) / 2)
    else:
        p_a, p_b = ((x0 + x1) / 2, y0), ((x0 + x1) / 2, y1)
    if not hand_pts:
        return p_b, p_a  # arbitrary; no hand ref to disambiguate
    hx, hy = hand_pts[0]
    d_a = np.hypot(p_a[0] - hx, p_a[1] - hy)
    d_b = np.hypot(p_b[0] - hx, p_b[1] - hy)
    knob, tip = (p_a, p_b) if d_a < d_b else (p_b, p_a)
    return tip, knob


def run(video_path, out_dir):
    video_path = pathlib.Path(video_path)
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not POSE_MODEL.exists() or not DET_MODEL.exists():
        raise SystemExit(
            f"Missing model weights. Expected:\n  {POSE_MODEL}\n  {DET_MODEL}\n"
            f"See scripts/pose3d/README.md for download instructions."
        )

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    print(f"[detect_2d] {video_path.name}  {frame_w}x{frame_h}  {fps:.2f}fps")

    pose_model = YOLO(str(POSE_MODEL))
    bat_model = YOLO(str(DET_MODEL))

    # --- Pass 1: pose, all people, every frame ---
    frames_people = []
    pose_results = pose_model.predict(
        source=str(video_path), stream=True, verbose=False,
        conf=0.25, device=0 if _cuda_available() else "cpu",
    )
    for r in pose_results:
        people = []
        if r.keypoints is not None and r.keypoints.xy is not None:
            xy = r.keypoints.xy.cpu().numpy()      # (n_people, 17, 2)
            cf = r.keypoints.conf
            cf = cf.cpu().numpy() if cf is not None else np.ones(xy.shape[:2])
            for i in range(xy.shape[0]):
                people.append((xy[i], cf[i]))
        frames_people.append(people)
    n_frames = len(frames_people)

    # --- Pass 2: bat detection + ByteTrack (runs before batter seeding below -
    # bat-holder proximity is what seeds the batter track; see
    # select_batter_track's docstring for why bbox-size seeding fails here). ---
    bat_frames = []  # per frame: list of (box, conf, track_id)
    bat_results = bat_model.track(
        source=str(video_path), stream=True, verbose=False,
        conf=0.15, classes=[BAT_CLASS_ID], tracker="bytetrack.yaml",
        persist=True, device=0 if _cuda_available() else "cpu",
    )
    for r in bat_results:
        dets = []
        if r.boxes is not None and len(r.boxes) > 0:
            xyxy = r.boxes.xyxy.cpu().numpy()
            conf = r.boxes.conf.cpu().numpy()
            ids = r.boxes.id.cpu().numpy() if r.boxes.id is not None else [-1] * len(xyxy)
            for box, c, tid in zip(xyxy, conf, ids):
                dets.append((tuple(box), float(c), int(tid)))
        bat_frames.append(dets)

    n_bat = sum(1 for d in bat_frames if d)
    print(f"[detect_2d] bat: {n_bat}/{n_frames} frames with >=1 bat detection")

    chosen = select_batter_track(frames_people, frame_w, frame_h, bat_frames)
    n_found = sum(1 for c in chosen if c is not None)
    print(f"[detect_2d] pose: {n_found}/{n_frames} frames with a tracked batter")

    # --- Smoothing + bat tip/knob selection, frame by frame ---
    kp_filters = [PointFilter2D(freq=fps, mincutoff=0.8, beta=0.4) for _ in range(NUM_KP)]
    tip_filter = PointFilter2D(freq=fps, mincutoff=0.6, beta=0.9)
    knob_filter = PointFilter2D(freq=fps, mincutoff=0.6, beta=0.9)
    gate_dist = 0.35 * frame_w

    pose_2d = []
    bat_path = []
    locked_track_id = None
    for i in range(n_frames):
        t = i / fps
        entry = chosen[i]
        if entry is not None:
            kps, conf = entry
            sm_kps = []
            for j in range(NUM_KP):
                x, y = kp_filters[j](float(kps[j][0]), float(kps[j][1]), t)
                sm_kps.append([round(x, 2), round(y, 2), round(float(conf[j]), 3)])
            pose_2d.append({"frame": i, "time_s": round(t, 4), "keypoints": sm_kps})
        else:
            pose_2d.append({"frame": i, "time_s": round(t, 4), "keypoints": None})

        hand_pts = batter_hand_positions(entry)
        if hand_pts:
            match, locked_track_id = select_bat_box(bat_frames[i], hand_pts, gate_dist, locked_track_id)
        else:
            match, locked_track_id = None, None
        if match is not None:
            box, bconf, tid = match
            tip, knob = bat_tip_and_knob(box, hand_pts)
            tx, ty = tip_filter(float(tip[0]), float(tip[1]), t)
            kx, ky = knob_filter(float(knob[0]), float(knob[1]), t)
            bat_path.append({
                "frame": i, "time_s": round(t, 4),
                "tip": [round(float(tx), 2), round(float(ty), 2)],
                "knob": [round(float(kx), 2), round(float(ky), 2)],
                "conf": round(float(bconf), 3), "track_id": int(tid),
            })
        else:
            bat_path.append({"frame": i, "time_s": round(t, 4), "tip": None, "knob": None,
                              "conf": None, "track_id": None})

    meta = {
        "video": str(video_path), "fps": fps, "width": frame_w, "height": frame_h,
        "n_frames": n_frames, "keypoint_order": "coco17",
        "keypoint_names": ["nose", "l_eye", "r_eye", "l_ear", "r_ear",
                           "l_shoulder", "r_shoulder", "l_elbow", "r_elbow",
                           "l_wrist", "r_wrist", "l_hip", "r_hip",
                           "l_knee", "r_knee", "l_ankle", "r_ankle"],
    }
    (out_dir / "pose_2d.json").write_text(json.dumps({"meta": meta, "frames": pose_2d}, indent=2))
    (out_dir / "bat_path.json").write_text(json.dumps({"meta": meta, "frames": bat_path}, indent=2))
    print(f"[detect_2d] wrote {out_dir / 'pose_2d.json'}")
    print(f"[detect_2d] wrote {out_dir / 'bat_path.json'}")
    return meta, pose_2d, bat_path


def _cuda_available():
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python detect_2d.py <video_path> <out_dir>")
        sys.exit(1)
    run(sys.argv[1], sys.argv[2])
