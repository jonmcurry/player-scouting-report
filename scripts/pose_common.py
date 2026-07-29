"""
Shared batter-selection tracking + landmark smoothing, used by pose_analyze.py,
pose_export_3d.py, and pose_silhouette.py.

Batter selection: picking the largest bounding box locks onto the UMPIRE, not the
batter, in this project's real behind-the-plate footage - he's closest to the
camera - verified against raw frames. Instead, seed at the batter's-box position
and follow the nearest hip center frame to frame, gated so a lost detection
(motion blur during the swing) freezes the track instead of snapping to the
catcher/umpire.

This used to be three separate, near-identical copies of the same tracking idea
(one per script). pose_analyze.py's copy was never updated when the other two
were fixed to seed+gate tracking - it silently kept using the old, already-
disproven largest-bbox heuristic. One shared implementation makes that kind of
silent drift impossible: fix it here, every caller gets the fix.
"""
import math

# Where the batter stands, in normalized frame coords, for this project's camera
# setup (first-base side, face-on, for a right-handed batter). Re-tune if the
# camera position changes.
BATTER_SEED = (0.40, 0.50)
TRACK_GATE = 0.10  # max normalized hip jump per frame; beyond this = detection lost

L_HIP, R_HIP = 23, 24

# Subset of BlazePose's 33 landmarks used for rendering/metrics across these scripts.
JOINTS = {
    "nose": 0,
    "l_shoulder": 11, "r_shoulder": 12,
    "l_elbow": 13, "r_elbow": 14,
    "l_wrist": 15, "r_wrist": 16,
    "l_hip": 23, "r_hip": 24,
    "l_knee": 25, "r_knee": 26,
    "l_ankle": 27, "r_ankle": 28,
    "l_foot": 31, "r_foot": 32,
}


def hip_center(landmarks):
    """Normalized (x, y) hip midpoint from a raw MediaPipe landmark list (indexable
    by numeric BlazePose index, e.g. result.pose_landmarks[i])."""
    return ((landmarks[L_HIP].x + landmarks[R_HIP].x) / 2,
            (landmarks[L_HIP].y + landmarks[R_HIP].y) / 2)


def make_tracker(seed=BATTER_SEED, gate=TRACK_GATE):
    """Returns pick(pose_landmarks_list) -> index of the batter in that frame's
    detections, or None if the nearest match this frame is farther than `gate`
    from the last known-good position (treated as a lost detection - freeze the
    track rather than snap to whoever's now closest, e.g. the catcher)."""
    state = {"prev": seed}

    def pick(pose_landmarks_list):
        if not pose_landmarks_list:
            return None
        px, py = state["prev"]
        idx = min(range(len(pose_landmarks_list)),
                  key=lambda i: (hip_center(pose_landmarks_list[i])[0] - px) ** 2 +
                                (hip_center(pose_landmarks_list[i])[1] - py) ** 2)
        hx, hy = hip_center(pose_landmarks_list[idx])
        if math.hypot(hx - px, hy - py) > gate:
            return None
        state["prev"] = (hx, hy)
        return idx

    return pick


def smooth_sequence(raw, window=3):
    """Centered moving average per joint, dimension-agnostic (works for 2D (x,y) or
    3D (x,y,z) tuples). `raw` is a list of {name: tuple} dicts, one per frame, or
    None for a frame where the batter wasn't tracked. Gaps are filled by carrying
    the last good frame forward before averaging, so a short tracking loss doesn't
    leave a hole in the output - stabilizes the overlay, which otherwise visibly
    wobbles frame to frame from real pose-detection noise.
    """
    filled = []
    last = None
    for fr in raw:
        if fr is not None:
            last = fr
        filled.append(last)

    n = len(filled)
    half = window // 2
    out = []
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        window_frames = [f for f in filled[lo:hi] if f is not None]
        if not window_frames:
            out.append(None)
            continue
        avg = {}
        for name in window_frames[0]:
            dims = len(window_frames[0][name])
            avg[name] = tuple(
                sum(f[name][d] for f in window_frames) / len(window_frames)
                for d in range(dims)
            )
        out.append(avg)
    return out
