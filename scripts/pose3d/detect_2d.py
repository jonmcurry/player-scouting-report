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

# Ultralytics' own default (DEFAULT_CFG.batch) - measured directly on a real
# 899-frame/1080p slice of an actual coach upload: batch=1 -> 46.5fps,
# batch=16 -> 83.8fps (1.8x). Verified this is NOT free-lunch bit-identical -
# batched GPU inference showed up to ~19px keypoint drift vs batch=1 on a
# small number of already-low-confidence phantom detections (conf<0.25,
# background people/occluded limbs the pipeline already discards via its own
# confidence gating and batter-track selection). Across every keypoint
# measured, median drift was 0.008px and the worst-case drift on a
# high-confidence (>0.99) keypoint was ~5px - well inside the raw per-frame
# jitter this pipeline's rigid-FK smoothing (see one_euro_filter.py /
# metrics.py's skeleton rigidification) already corrects for. Not raised
# further (e.g. to 32) - the measured speedup past 16 was marginal (1.92x)
# for no meaningful additional gain.
BATCH_SIZE = 16

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


# Originally raw frame counts (MIN_TRACK_LEN=15, an inline gap tolerance of
# 8) - converted to real-time spans, resolved to a frame count via each
# clip's own fps at the point of use, same reasoning as metrics.py's
# ROTATION_WINDOW_S etc.: a fixed frame-count window covers 8x less real time
# at 240fps than at ~30fps, which would make these track-continuity
# tolerances far too strict for high-frame-rate input.
MIN_TRACK_DURATION_S = 15 / 30
TRACK_GAP_TOLERANCE_S = 8 / 30
BAT_HOLD_GATE_FRAC = 0.15  # wrist-to-bat-centroid distance, as a fraction of frame width

# --- Quick pre-check, before committing to the two full per-frame passes ---
# Real coach uploads can be several minutes long (see run_pipeline.py's
# Stage 0 docstring), and this stage's two full YOLO passes over every frame
# is what actually costs those minutes. Confirmed on real data: a 7.8-minute
# clip where only 0.62% of ALL frames had a tracked batter still took ~13
# minutes to grind through both full passes before failing. Sampling a
# handful of frames up front and running the same pose model on just those
# catches that same hopeless case in seconds, not minutes.
QUALITY_CHECK_SAMPLE_FRAMES = 30
QUALITY_CHECK_MIN_RESOLVABLE_FRACTION = 0.15  # real clips seen so far are
    # either ~99%+ trackable or under 1% - this sits comfortably in that gap,
    # not a fragile/tight cutoff.
QUALITY_CHECK_MIN_BBOX_HEIGHT_FRAC = 0.08  # a detected person's bbox must be
    # at least this tall (as a fraction of frame height) to count as
    # "clearly resolvable" - filters out a speck-sized, low-confidence guess
    # that technically passes bbox_from_kps's point-count check.


class LowQualityFootageError(Exception):
    """Raised by quick_trackability_check when nobody is clearly resolvable
    in a sample of frames - before the expensive full passes ever run. See
    that function's docstring for exactly what this does and doesn't
    guarantee."""


def build_person_tracks(frames_people, frame_w, fps):
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
    gap_tolerance = max(1, round(TRACK_GAP_TOLERANCE_S * fps))
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
                if tid in used_tracks or i - last_i > gap_tolerance:
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


def build_batter_track(tracks, bat_frames, frame_w, fps):
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
    min_track_len = max(1, round(MIN_TRACK_DURATION_S * fps))
    scores = {tid: 0 for tid in tracks}
    for tid, frames in tracks.items():
        if len(frames) < min_track_len:
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

    eligible = {tid: s for tid, s in scores.items() if len(tracks[tid]) >= min_track_len}
    if not eligible or max(eligible.values()) == 0:
        # No track shows consistent bat-holding evidence at all - fall back to
        # the single longest track (most-consistently-detected person is a
        # reasonable last resort, clearly logged rather than silently trusted).
        # Reported back to run() (not just printed) so a downstream "cannot
        # locate contact" failure can distinguish THIS specific cause - clean
        # person-tracking but essentially no bat evidence anywhere - from a
        # generic tracking failure. A real clip traced this to a camera
        # positioned along the baseline instead of behind the backstop: the
        # batter is small/distant in every frame, so the bat rarely resolves
        # to enough pixels for the detector, while the person themselves
        # tracks fine (they're not small, just their bat is).
        print("[detect_2d] WARNING: no track shows consistent bat-holding evidence - "
              "falling back to the longest-tracked person (may not be the batter)")
        best_tid = max(tracks, key=lambda tid: len(tracks[tid]))
        return best_tid, 0, True

    best_tid = max(eligible, key=eligible.get)
    print(f"[detect_2d] batter track selected: id={best_tid}, "
          f"{len(tracks[best_tid])} frames tracked, "
          f"bat-holding evidence in {scores[best_tid]} frames")
    return best_tid, scores[best_tid], False


def select_batter_track(frames_people, frame_w, frame_h, fps, bat_frames=None):
    """frames_people[i] = list of (kps[17,2], conf[17]) detections in frame i.
    bat_frames[i] = list of (box, conf, track_id) bat detections in frame i.

    Returns (chosen, bat_evidence_stats) - chosen is a list, one entry per
    frame, of the chosen person's (kps, conf) or None if nobody plausible was
    found in that frame; bat_evidence_stats is
    {"track_frames", "bat_evidence_frames", "used_fallback"} - see
    build_batter_track for how the batter identity is picked and why this is
    tracked.
    """
    tracks = build_person_tracks(frames_people, frame_w, fps)
    if not tracks:
        return [None] * len(frames_people), {"track_frames": 0, "bat_evidence_frames": 0, "used_fallback": False}

    batter_tid, bat_evidence_frames, used_fallback = build_batter_track(tracks, bat_frames or [], frame_w, fps)
    batter_frames = tracks[batter_tid]

    chosen = [None] * len(frames_people)
    for i, entry in batter_frames.items():
        chosen[i] = entry
    stats = {
        "track_frames": len(batter_frames),
        "bat_evidence_frames": bat_evidence_frames,
        "used_fallback": used_fallback,
    }
    return chosen, stats


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


def quick_trackability_check(video_path, pose_model, frame_w, frame_h, n_frames):
    """Samples QUALITY_CHECK_SAMPLE_FRAMES evenly-spaced frames (not the
    whole clip) and runs the already-loaded pose model on just those, to
    cheaply estimate whether anyone is clearly resolvable in this footage at
    all. This is a fast, honest early warning, NOT a replacement for the
    real batter-selection logic below (select_batter_track needs
    frame-to-frame track continuity a sparse sample can't provide, and only
    counts a track that also shows bat-holding evidence - a stricter bar
    than "some person is visible"). If this check passes, the full analysis
    still runs exactly as before and remains the authoritative answer; this
    only exists to bail out fast on the obviously-hopeless case.

    Returns (resolvable_fraction, sampled_count)."""
    cap = cv2.VideoCapture(str(video_path))
    n_samples = min(QUALITY_CHECK_SAMPLE_FRAMES, n_frames)
    sample_indices = np.linspace(0, max(n_frames - 1, 0), n_samples, dtype=int)
    min_bbox_h = QUALITY_CHECK_MIN_BBOX_HEIGHT_FRAC * frame_h
    device = 0 if _cuda_available() else "cpu"

    resolvable = 0
    checked = 0
    for idx in sample_indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ok, frame = cap.read()
        if not ok:
            continue
        checked += 1
        result = pose_model.predict(frame, conf=0.25, verbose=False, device=device)
        r = result[0]
        if r.keypoints is None or r.keypoints.xy is None:
            continue
        xy = r.keypoints.xy.cpu().numpy()
        cf = r.keypoints.conf
        cf = cf.cpu().numpy() if cf is not None else np.ones(xy.shape[:2])
        for i in range(xy.shape[0]):
            box = bbox_from_kps(xy[i], cf[i])
            if box is not None and (box[3] - box[1]) >= min_bbox_h:
                resolvable += 1
                break
    cap.release()
    return (resolvable / checked if checked else 0.0), checked


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
    n_frames_hint = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    print(f"[detect_2d] {video_path.name}  {frame_w}x{frame_h}  {fps:.2f}fps")

    pose_model = YOLO(str(POSE_MODEL))
    bat_model = YOLO(str(DET_MODEL))

    if n_frames_hint > QUALITY_CHECK_SAMPLE_FRAMES:
        tracked_frac, sampled = quick_trackability_check(
            video_path, pose_model, frame_w, frame_h, n_frames_hint)
        print(f"[detect_2d] quick quality check: {tracked_frac * 100:.0f}% of "
              f"{sampled} sampled frames had a clearly-resolvable person")
        if tracked_frac < QUALITY_CHECK_MIN_RESOLVABLE_FRACTION:
            meta = {
                "video": str(video_path), "fps": fps, "width": frame_w, "height": frame_h,
                "n_frames": n_frames_hint, "keypoint_order": "coco17",
                "keypoint_names": ["nose", "l_eye", "r_eye", "l_ear", "r_ear",
                                   "l_shoulder", "r_shoulder", "l_elbow", "r_elbow",
                                   "l_wrist", "r_wrist", "l_hip", "r_hip",
                                   "l_knee", "r_knee", "l_ankle", "r_ankle"],
            }
            # Written now (not left to run_pipeline.py) so pose_2d.json/
            # bat_path.json exist as valid JSON regardless of outcome -
            # ingestPhases.ts reads pose_2d.json unconditionally before ever
            # checking metrics.json's phases/error fields.
            (out_dir / "pose_2d.json").write_text(json.dumps({"meta": meta, "frames": []}, indent=2))
            (out_dir / "bat_path.json").write_text(json.dumps({"meta": meta, "frames": []}, indent=2))
            raise LowQualityFootageError(
                f"Couldn't reliably detect a batter in this video (only "
                f"{tracked_frac * 100:.0f}% of a {sampled}-frame quick sample had a "
                f"clearly resolvable person) - try filming closer to home plate or "
                f"with the camera in better focus."
            )

    # --- Pass 1: pose, all people, every frame ---
    frames_people = []
    pose_results = pose_model.predict(
        source=str(video_path), stream=True, verbose=False,
        conf=0.25, device=0 if _cuda_available() else "cpu",
        batch=BATCH_SIZE if _cuda_available() else 1,
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
        batch=BATCH_SIZE if _cuda_available() else 1,
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

    chosen, bat_evidence_stats = select_batter_track(frames_people, frame_w, frame_h, fps, bat_frames)
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
        # Persisted (not just printed) so a downstream "cannot locate
        # contact" failure can tell "clean person tracking, but almost no
        # real bat evidence anywhere" (a real clip traced this to a camera
        # positioned along the baseline instead of behind the backstop - the
        # batter tracks fine, but is too small/distant for the bat itself to
        # resolve) apart from a generic tracking failure - see metrics.py's
        # own use of this field.
        "bat_evidence": bat_evidence_stats,
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
