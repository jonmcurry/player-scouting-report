"""
Render a real swing clip with her identity protected (face blurred) and a
tracked bat-path overlay - her real path (blue) plus a schematic target path
(amber) for the coached adjustment - matching the style of a reference video
the user pointed to, without publishing her real, identifiable image.

Reuses the batter-tracking and landmark-smoothing machinery from
pose_silhouette.py (same BATTER_SEED/TRACK_GATE, same median+outlier-aware
smoothing philosophy) since that part was already solved and validated there;
what's new here is: no segmentation mask at all (real video frames, just
face-blurred), and drawing an accumulating bat-tip trail instead of a
per-frame skeleton.

Usage: python render_real_overlay.py <video> <start_s> <end_s> <out_dir>
"""
import sys
import pathlib

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

MODEL_PATH = pathlib.Path(__file__).parent / "models" / "pose_landmarker_full.task"

JOINTS = {
    "nose": 0, "l_shoulder": 11, "r_shoulder": 12, "l_elbow": 13, "r_elbow": 14,
    "l_wrist": 15, "r_wrist": 16, "l_hip": 23, "r_hip": 24, "l_knee": 25,
    "r_knee": 26, "l_ankle": 27, "r_ankle": 28, "l_foot": 31, "r_foot": 32,
}
LOWER_BODY = ["l_hip", "r_hip", "l_knee", "r_knee", "l_ankle", "r_ankle", "l_foot", "r_foot"]

BATTER_SEED = (0.40, 0.50)
TRACK_GATE = 0.10

CONTACT_FRAME = 112
TRAIL_LEN = 10  # frames of bat-tip history drawn as a fading trail


def make_landmarker():
    return mp_vision.PoseLandmarker.create_from_options(mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=4,
    ))


def hip_center_norm(lms):
    return ((lms[JOINTS["l_hip"]].x + lms[JOINTS["r_hip"]].x) / 2,
             (lms[JOINTS["l_hip"]].y + lms[JOINTS["r_hip"]].y) / 2)


def make_tracker():
    state = {"prev": BATTER_SEED}

    def pick(result):
        px, py = state["prev"]
        idx = min(range(len(result.pose_landmarks)),
                  key=lambda i: (hip_center_norm(result.pose_landmarks[i])[0] - px) ** 2 +
                                (hip_center_norm(result.pose_landmarks[i])[1] - py) ** 2)
        hx, hy = hip_center_norm(result.pose_landmarks[idx])
        if ((hx - px) ** 2 + (hy - py) ** 2) ** 0.5 > TRACK_GATE:
            return None
        state["prev"] = (hx, hy)
        return idx

    return pick


def smooth_sequence(raw, window=7):
    """Median filter (rejects gross single-frame outlier spikes - see
    pose_export_3d.py for why a plain moving average alone isn't enough)
    then a centered moving average, per joint per axis."""
    filled = []
    last = None
    for fr in raw:
        if fr is not None:
            last = fr
        filled.append(last)
    n = len(filled)
    names = list(JOINTS.keys())
    arr = np.array([[filled[i][name] for name in names] for i in range(n)])  # (T, J, 2)

    from scipy.signal import medfilt, savgol_filter
    med_k = min(7, n if n % 2 == 1 else n - 1)
    if med_k >= 3:
        arr = medfilt(arr, kernel_size=(med_k, 1, 1))
    sg_w = min(9, n if n % 2 == 1 else n - 1)
    if sg_w >= 5:
        arr = savgol_filter(arr, window_length=sg_w, polyorder=2, axis=0, mode="nearest")

    return [{name: (float(arr[i, j, 0]), float(arr[i, j, 1])) for j, name in enumerate(names)} for i in range(n)]


def bat_tip(lms):
    lw, rw, le, re = lms["l_wrist"], lms["r_wrist"], lms["l_elbow"], lms["r_elbow"]
    grip = ((lw[0] + rw[0]) / 2, (lw[1] + rw[1]) / 2)
    fx = (lw[0] - le[0]) + (rw[0] - re[0])
    fy = (lw[1] - le[1]) + (rw[1] - re[1])
    flen = (fx * fx + fy * fy) ** 0.5
    if flen <= 8:
        return grip
    fx, fy = fx / flen, fy / flen
    fore_px = (((lw[0] - le[0]) ** 2 + (lw[1] - le[1]) ** 2) ** 0.5 +
               ((rw[0] - re[0]) ** 2 + (rw[1] - re[1]) ** 2) ** 0.5) / 2
    blen = fore_px * 2.4
    return (grip[0] + fx * blen, grip[1] + fy * blen)


def main():
    video, start_s, end_s = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    out_dir = pathlib.Path(sys.argv[4])
    out_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    raw = []
    frames_bgr = []
    pick = make_tracker()
    with make_landmarker() as lm:
        idx = 0
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            t = idx / fps
            if t > end_s:
                break
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = lm.detect_for_video(image, int(t * 1000))
            if t >= start_s:
                bi = pick(result) if result.pose_landmarks else None
                if bi is None:
                    raw.append(None)
                else:
                    h, w = bgr.shape[:2]
                    lms_raw = result.pose_landmarks[bi]
                    raw.append({name: (lms_raw[i].x * w, lms_raw[i].y * h) for name, i in JOINTS.items()})
                frames_bgr.append(bgr)
            idx += 1
    cap.release()

    smoothed = smooth_sequence(raw)
    n = len(smoothed)

    tips_current = [bat_tip(smoothed[i]) for i in range(n)]

    left = min(min(fr[name][0] for name in JOINTS) for fr in smoothed)
    right = max(max(fr[name][0] for name in JOINTS) for fr in smoothed)
    top = min(min(fr[name][1] for name in JOINTS) for fr in smoothed)
    bottom = max(max(fr[name][1] for name in JOINTS) for fr in smoothed)
    tip_xs = [t[0] for t in tips_current]
    tip_ys = [t[1] for t in tips_current]
    left, right = min(left, min(tip_xs)), max(right, max(tip_xs))
    top, bottom = min(top, min(tip_ys)), max(bottom, max(tip_ys))
    bw, bh = right - left, bottom - top
    x0 = int(max(0, left - bw * 0.15))
    x1 = int(right + bw * 0.15)
    y0 = int(max(0, top - bh * 0.15))
    y1 = int(bottom + bh * 0.10)
    print(f"crop box: x {x0}-{x1}, y {y0}-{y1}")

    out_frames = []
    for i in range(n):
        bgr = frames_bgr[i].copy()
        lms = smoothed[i]
        h, w = bgr.shape[:2]

        # face blur: privacy protection on real video - a soft, generous
        # ellipse around the head, blurred hard enough that no facial detail
        # survives, while leaving the rest of her body (the actual swing
        # mechanics being illustrated) fully sharp and visible
        nose = lms["nose"]
        neck = ((lms["l_shoulder"][0] + lms["r_shoulder"][0]) / 2, (lms["l_shoulder"][1] + lms["r_shoulder"][1]) / 2)
        # Sized from shoulder width, not nose-to-neck distance - that first
        # attempt produced a blur circle covering most of her upper body
        # (checked against the actual rendered frame, not assumed correct).
        # A head is roughly 0.55-0.65x shoulder width across; some margin on
        # top since this needs to fully cover the head, not just approximate it.
        shoulder_w = ((lms["l_shoulder"][0] - lms["r_shoulder"][0]) ** 2 +
                      (lms["l_shoulder"][1] - lms["r_shoulder"][1]) ** 2) ** 0.5
        head_r = int(max(22, shoulder_w * 0.7))
        cx, cy = int(nose[0]), int(nose[1])
        bx0, bx1 = max(0, cx - head_r), min(w, cx + head_r)
        by0, by1 = max(0, cy - head_r), min(h, cy + head_r)
        if bx1 > bx0 and by1 > by0:
            roi = bgr[by0:by1, bx0:bx1]
            k = max(31, (min(roi.shape[0], roi.shape[1]) // 2) * 2 + 1)
            blurred = cv2.GaussianBlur(roi, (k, k), 0)
            mask = np.zeros(roi.shape[:2], dtype=np.uint8)
            cv2.ellipse(mask, ((bx1 - bx0) // 2, (by1 - by0) // 2),
                        (head_r, int(head_r * 1.15)), 0, 0, 360, 255, -1)
            mask = cv2.GaussianBlur(mask, (21, 21), 0)
            mask_f = (mask.astype(np.float32) / 255)[..., None]
            bgr[by0:by1, bx0:bx1] = (roi.astype(np.float32) * (1 - mask_f) +
                                       blurred.astype(np.float32) * mask_f).astype(np.uint8)

        crop = bgr[y0:y1, x0:x1]

        def to_crop(p):
            return (int(p[0]) - x0, int(p[1]) - y0)

        # fading trail of recent bat-tip positions - her real path (cyan),
        # matching the reference video's bat-path line
        for j in range(max(0, i - TRAIL_LEN), i):
            a, b = to_crop(tips_current[j]), to_crop(tips_current[j + 1])
            alpha = (j - max(0, i - TRAIL_LEN) + 1) / TRAIL_LEN
            color = (int(80 + 100 * alpha), int(180 + 60 * alpha), int(30))
            cv2.line(crop, a, b, color, max(2, int(5 * alpha)), cv2.LINE_AA)

        cur_pt = to_crop(tips_current[i])
        cv2.circle(crop, cur_pt, 6, (30, 220, 120), -1, cv2.LINE_AA)

        # Target: an honest marker, not a fabricated alternate bat path. A
        # rotation applied only to the lower-body joints (the schematic hip-
        # lead adjustment used throughout this feature) can't actually move
        # the bat, since the bat tip is computed purely from wrist/elbow -
        # first attempt here quietly produced a target trail identical to the
        # real one, which would have overstated what the model can support.
        # What IS honest: marking where contact should happen instead, along
        # her OWN real bat path - the Sierra Romero "let it travel deeper"
        # cue from her scouting report - near the real contact instant.
        if abs(i - CONTACT_FRAME) <= 3:
            back = lms["r_ankle"] if lms["r_ankle"][0] > lms["l_ankle"][0] else lms["l_ankle"]
            front = lms["l_ankle"] if back is lms["r_ankle"] else lms["r_ankle"]
            d = (back[0] - front[0], back[1] - front[1])
            dl = (d[0] ** 2 + d[1] ** 2) ** 0.5 or 1
            shift = (d[0] / dl * bw * 0.12, d[1] / dl * bw * 0.12)
            tgt_pt = to_crop((tips_current[i][0] + shift[0], tips_current[i][1] + shift[1]))
            cv2.circle(crop, tgt_pt, 7, (10, 175, 250), -1, cv2.LINE_AA)
            cv2.line(crop, cur_pt, tgt_pt, (10, 175, 250), 2, cv2.LINE_AA)

        out_frames.append(crop)

    target_w = 480
    total = 0
    for i, fr in enumerate(out_frames):
        scale = target_w / fr.shape[1]
        resized = cv2.resize(fr, (target_w, int(fr.shape[0] * scale)), interpolation=cv2.INTER_AREA)
        p = out_dir / f"real_{i:03d}.webp"
        cv2.imwrite(str(p), resized, [cv2.IMWRITE_WEBP_QUALITY, 80])
        total += p.stat().st_size
    print(f"{len(out_frames)} frames, {total/1e6:.2f} MB total, avg {total/len(out_frames)/1024:.0f} KB")


if __name__ == "__main__":
    main()
