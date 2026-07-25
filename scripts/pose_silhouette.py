"""
Render a swing clip window as two privacy-safe silhouette sequences for the 3D
swing model page: "current" (her real body/mechanics, temporally smoothed to
remove per-frame pose-detection jitter) and "target" (the same real body, with
the coached hip-lead adjustment and a deeper contact point applied as a 2D
shear/shift on top of the real silhouette and skeleton — not a different
person, not motion capture, just an illustrated adjustment to her own swing).

The player's real body is cut out via MediaPipe person segmentation, flattened
to one flat blue (no face/jersey/identifying detail), with a WinReality-style
colored skeleton overlay and synthesized bat baked in.

Three passes over the window:
  1. Collect raw landmarks (no masks - cheap) to build one fixed crop box and
     a temporally-smoothed landmark sequence (stabilizes the overlay skeleton,
     which otherwise visibly jitters frame to frame from detection noise).
  2. Re-run with masks; pair each frame's mask with the SAME-INDEX smoothed
     landmarks from pass 1 (both passes use the same deterministic tracker, so
     indices line up) and render the "current" frame.
  3. From the same smoothed landmarks + mask, render the "target" frame with
     the lower body sheared by a time-varying offset.

Usage: python pose_silhouette.py <video> <start_s> <end_s> <out_dir>
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

# colors are BGR (cv2); silhouette fill is the site's series-1 blue
SIL_BGR = (229, 135, 57)          # #3987e5
DARK = (25, 26, 26)               # contrast underlay stroke
AMBER = (25, 178, 250)            # torso
WHITE = (255, 255, 255)           # arms
GREEN = (12, 163, 12)             # legs
HIP_LEAD_COLOR = (34, 178, 250)   # amber hip line, target frames only
BAT = (87, 141, 176)              # #b08d57
BALL = (0, 176, 224)              # #e0b000

TORSO = [("l_shoulder", "r_shoulder"), ("l_hip", "r_hip"),
         ("l_shoulder", "l_hip"), ("r_shoulder", "r_hip"),
         ("l_shoulder", "r_hip"), ("r_shoulder", "l_hip")]
ARMS = [("l_shoulder", "l_elbow"), ("l_elbow", "l_wrist"), ("r_shoulder", "r_elbow"), ("r_elbow", "r_wrist")]
LEGS = [("l_hip", "l_knee"), ("l_knee", "l_ankle"), ("l_ankle", "l_foot"),
        ("r_hip", "r_knee"), ("r_knee", "r_ankle"), ("r_ankle", "r_foot")]
JOINT_DOTS = ["l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_hip", "r_hip", "l_knee", "r_knee", "l_ankle", "r_ankle"]

CONTACT_FRAME = 112  # matches the viewer's data-located contact frame

# Where the batter stands, in normalized frame coords, for this behind-the-plate
# footage. Seeding selection here matters: largest-bounding-box seeds on the
# UMPIRE (closest to camera), not the batter - verified against raw frames.
BATTER_SEED = (0.40, 0.50)
TRACK_GATE = 0.10  # max normalized hip jump per frame; beyond this = detection lost

# Schematic hip-lead envelope (frame indices, matches the timing used for this
# swing's phases): ramps in through the late load, peaks at contact, releases
# on follow-through. This mirrors the JS hipLeadAngle() that used to drive the
# 3D-projected schematic panel; here it drives a 2D shear on the real body.
RAMP_IN, PEAK, RELEASE = 80, 110, 128
MAX_SHIFT_PX = 26  # at 360px-wide output; scaled by crop width at render time


def hip_lead_k(frame_idx):
    if frame_idx < RAMP_IN or frame_idx > RELEASE:
        return 0.0
    if frame_idx <= PEAK:
        return (frame_idx - RAMP_IN) / (PEAK - RAMP_IN)
    return 1 - (frame_idx - PEAK) / (RELEASE - PEAK)


def make_landmarker(with_masks):
    return mp_vision.PoseLandmarker.create_from_options(mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=4,  # umpire + catcher + batter + a fielder can all be in frame
        output_segmentation_masks=with_masks,
    ))


def hip_center_norm(lms):
    return ((lms[JOINTS["l_hip"]].x + lms[JOINTS["r_hip"]].x) / 2,
             (lms[JOINTS["l_hip"]].y + lms[JOINTS["r_hip"]].y) / 2)


def make_tracker():
    """Batter selection: seed at the batter's-box position, then follow the nearest
    hip center frame to frame, gated so a lost detection (motion blur during the
    swing) freezes the track instead of snapping to the catcher or umpire."""
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


def iterate(video_path, start_s, end_s, with_masks, on_frame):
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    idx = 0
    pick = make_tracker()
    with make_landmarker(with_masks) as lm:
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
            if t >= start_s and result.pose_landmarks:
                on_frame(bgr, result, pick(result))
            idx += 1
    cap.release()


def stroke(img, p1, p2, color, w):
    cv2.line(img, p1, p2, (*DARK, 255), w + 4, cv2.LINE_AA)
    cv2.line(img, p1, p2, (*color, 255), w, cv2.LINE_AA)


def smooth_sequence(raw, window=3):
    """Centered moving average per joint, filling gaps (None frames) by carrying
    the last good reading forward first. Stabilizes the overlay skeleton, which
    otherwise visibly wobbles frame to frame from real pose-detection noise."""
    filled = []
    last = None
    for fr in raw:
        if fr is not None:
            last = fr
        filled.append(last)
    n = len(filled)
    out = []
    half = window // 2
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i + half + 1)
        window_frames = [f for f in filled[lo:hi] if f is not None]
        avg = {}
        for name in JOINTS:
            xs = [f[name][0] for f in window_frames]
            ys = [f[name][1] for f in window_frames]
            avg[name] = (sum(xs) / len(xs), sum(ys) / len(ys))
        out.append(avg)
    return out


def shear_mask(mask, hip_y, shift_px):
    if abs(shift_px) < 0.5:
        return mask
    h, w = mask.shape[:2]
    map_x, map_y = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    below = map_y > hip_y
    map_x[below] -= shift_px
    return cv2.remap(mask, map_x, map_y, interpolation=cv2.INTER_LINEAR, borderValue=0)


def draw_frame(mask_full, lms, w, h, x0, y0, x1, y1, contact_frame_here, ball_shift):
    """lms: dict of name -> (x, y) in FULL-FRAME pixel coords. Returns the cropped
    RGBA silhouette+overlay image (still at crop resolution, not yet resized)."""
    crop_mask = mask_full[y0:y1, x0:x1]
    ch, cw = crop_mask.shape[:2]
    rgba = np.zeros((ch, cw, 4), dtype=np.uint8)
    soft = cv2.GaussianBlur(np.clip(crop_mask, 0, 1), (5, 5), 0)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = SIL_BGR
    rgba[..., 3] = (soft * 255).astype(np.uint8)

    def px(name):
        return (int(lms[name][0]) - x0, int(lms[name][1]) - y0)

    for a, b in TORSO:
        stroke(rgba, px(a), px(b), AMBER, 3)
    for a, b in LEGS:
        stroke(rgba, px(a), px(b), GREEN, 4)
    for a, b in ARMS:
        stroke(rgba, px(a), px(b), WHITE, 4)
    for name in JOINT_DOTS:
        cv2.circle(rgba, px(name), 5, (*DARK, 255), -1, cv2.LINE_AA)
        cv2.circle(rgba, px(name), 3, (*WHITE, 255), -1, cv2.LINE_AA)

    lw, rw, le, re = px("l_wrist"), px("r_wrist"), px("l_elbow"), px("r_elbow")
    grip = ((lw[0] + rw[0]) // 2, (lw[1] + rw[1]) // 2)
    fx = (lw[0] - le[0]) + (rw[0] - re[0])
    fy = (lw[1] - le[1]) + (rw[1] - re[1])
    flen = (fx * fx + fy * fy) ** 0.5
    if flen > 8:
        fx, fy = fx / flen, fy / flen
        fore_px = (((lw[0] - le[0]) ** 2 + (lw[1] - le[1]) ** 2) ** 0.5 +
                   ((rw[0] - re[0]) ** 2 + (rw[1] - re[1]) ** 2) ** 0.5) / 2
        blen = fore_px * 2.4
        mid = (int(grip[0] + fx * blen * 0.45), int(grip[1] + fy * blen * 0.45))
        tip = (int(grip[0] + fx * blen), int(grip[1] + fy * blen))
        stroke(rgba, grip, mid, BAT, 4)
        stroke(rgba, mid, tip, BAT, 8)
        if contact_frame_here:
            depth = 0.75 + ball_shift
            bp = (int(grip[0] + fx * blen * depth), int(grip[1] + fy * blen * depth))
            cv2.circle(rgba, bp, 11, (*BALL, 255), -1, cv2.LINE_AA)
            cv2.circle(rgba, bp, 16, (*BALL, 255), 2, cv2.LINE_AA)

    return rgba


def save_all(frames, out_dir, prefix):
    total = 0
    for i, fr in enumerate(frames):
        p = out_dir / f"{prefix}_{i:03d}.webp"
        cv2.imwrite(str(p), fr, [cv2.IMWRITE_WEBP_QUALITY, 72])
        total += p.stat().st_size
    print(f"{prefix}: {len(frames)} frames, {total/1e6:.2f} MB total, avg {total/len(frames)/1024:.0f} KB")


def main():
    video, start_s, end_s = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    out_dir = pathlib.Path(sys.argv[4])
    out_dir.mkdir(parents=True, exist_ok=True)

    # Pass 1: raw landmarks only (cheap - no segmentation), for crop bounds + smoothing
    raw = []

    def collect(bgr, result, bi):
        if bi is None:
            raw.append(None)
            return
        h, w = bgr.shape[:2]
        lms = result.pose_landmarks[bi]
        raw.append({name: (lms[idx].x * w, lms[idx].y * h) for name, idx in JOINTS.items()})

    iterate(video, start_s, end_s, False, collect)
    smoothed = smooth_sequence(raw, window=3)

    left = np.percentile([min(fr[n][0] for n in JOINTS) for fr in smoothed], 5)
    right = np.percentile([max(fr[n][0] for n in JOINTS) for fr in smoothed], 95)
    top = np.percentile([min(fr[n][1] for n in JOINTS) for fr in smoothed], 5)
    bottom = np.percentile([max(fr[n][1] for n in JOINTS) for fr in smoothed], 95)
    bw, bh = right - left, bottom - top
    x0 = int(max(0, left - bw * 0.20))
    x1 = int(right + bw * 0.20)
    y0 = int(max(0, top - bh * 0.30))
    y1 = int(bottom + bh * 0.08)
    print(f"crop box: x {x0}-{x1}, y {y0}-{y1}")

    # Pass 2: re-run with masks. Same deterministic tracker + same video means the
    # None-pattern lines up frame-for-frame with pass 1, so index i here always
    # corresponds to smoothed[i].
    current_frames = []
    target_frames = []
    idx_counter = [0]

    def render(bgr, result, bi):
        i = idx_counter[0]
        idx_counter[0] += 1
        lms = smoothed[i] if i < len(smoothed) else None

        if bi is None or lms is None:
            if current_frames:
                current_frames.append(current_frames[-1].copy())
                target_frames.append(target_frames[-1].copy())
            return

        h, w = bgr.shape[:2]
        mask = result.segmentation_masks[bi].numpy_view()

        # limit the mask to a padded box around the tracked batter so segmentation
        # bleed from other people on the field doesn't leave ghost blobs
        pxs = [lms[n][0] for n in JOINTS]
        pys = [lms[n][1] for n in JOINTS]
        pad_x = (max(pxs) - min(pxs)) * 0.35
        pad_y = (max(pys) - min(pys)) * 0.25
        keep = np.zeros_like(mask)
        ky0, ky1 = int(max(0, min(pys) - pad_y)), int(min(h, max(pys) + pad_y))
        kx0, kx1 = int(max(0, min(pxs) - pad_x)), int(min(w, max(pxs) + pad_x))
        keep[ky0:ky1, kx0:kx1] = 1
        mask = mask * keep

        is_contact = abs(i - CONTACT_FRAME) <= 3
        current_rgba = draw_frame(mask, lms, w, h, x0, y0, x1, y1, is_contact, ball_shift=0.0)

        # target: shear the lower body (mask + landmarks) toward the swing direction,
        # scaled by the hip-lead envelope; deepen the contact point along the bat
        k = hip_lead_k(i)
        crop_w = x1 - x0
        shift_px_full = MAX_SHIFT_PX * (crop_w / 360.0) * k
        # direction: same horizontal sense as the bat's swing-through extension
        fx_dir = (lms["l_wrist"][0] - lms["l_elbow"][0]) + (lms["r_wrist"][0] - lms["r_elbow"][0])
        shift_px_full *= 1 if fx_dir >= 0 else -1
        hip_y = (lms["l_hip"][1] + lms["r_hip"][1]) / 2

        target_mask = shear_mask(mask, hip_y, shift_px_full)
        target_lms = dict(lms)
        for name in LOWER_BODY:
            target_lms[name] = (lms[name][0] + shift_px_full, lms[name][1])
        target_rgba = draw_frame(target_mask, target_lms, w, h, x0, y0, x1, y1, is_contact, ball_shift=0.12)
        if k > 0.02:
            def px(name, d=target_lms):
                return (int(d[name][0]) - x0, int(d[name][1]) - y0)
            stroke(target_rgba, px("l_hip"), px("r_hip"), HIP_LEAD_COLOR, 5)

        target_w = 360
        scale = target_w / current_rgba.shape[1]
        size = (target_w, int(current_rgba.shape[0] * scale))
        current_frames.append(cv2.resize(current_rgba, size, interpolation=cv2.INTER_AREA))
        target_frames.append(cv2.resize(target_rgba, size, interpolation=cv2.INTER_AREA))

    iterate(video, start_s, end_s, True, render)

    save_all(current_frames, out_dir, "sil")
    save_all(target_frames, out_dir, "tgt")


if __name__ == "__main__":
    main()
