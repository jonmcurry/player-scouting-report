"""
Render a swing clip window as privacy-safe silhouette frames: the player's real
body cut out via MediaPipe person segmentation, flattened to one flat blue (no
face/jersey/identifying detail), with a WinReality-style colored skeleton overlay
and synthesized bat baked in. Output PNGs get base64-embedded into the 3D swing
model page, replacing the schematic stick figure for the "current swing" panel.

Two passes over the window: pass 1 collects 2D landmarks to compute one fixed
crop box (stable framing); pass 2 renders the silhouette frames inside that crop.

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

L_SH, R_SH, L_EL, R_EL, L_WR, R_WR = 11, 12, 13, 14, 15, 16
L_HIP, R_HIP, L_KN, R_KN, L_AN, R_AN, L_FT, R_FT = 23, 24, 25, 26, 27, 28, 31, 32
ALL = [0, L_SH, R_SH, L_EL, R_EL, L_WR, R_WR, L_HIP, R_HIP, L_KN, R_KN, L_AN, R_AN, L_FT, R_FT]

# colors are BGR (cv2); silhouette fill is the site's series-1 blue
SIL_BGR = (229, 135, 57)          # #3987e5
DARK = (25, 26, 26)               # contrast underlay stroke
AMBER = (25, 178, 250)            # torso
WHITE = (255, 255, 255)           # arms
GREEN = (12, 163, 12)             # legs
BAT = (87, 141, 176)              # #b08d57
BALL = (0, 176, 224)              # #e0b000

TORSO = [(L_SH, R_SH), (L_HIP, R_HIP), (L_SH, L_HIP), (R_SH, R_HIP), (L_SH, R_HIP), (R_SH, L_HIP)]
ARMS = [(L_SH, L_EL), (L_EL, L_WR), (R_SH, R_EL), (R_EL, R_WR)]
LEGS = [(L_HIP, L_KN), (L_KN, L_AN), (L_AN, L_FT), (R_HIP, R_KN), (R_KN, R_AN), (R_AN, R_FT)]

CONTACT_FRAME = 112  # matches the viewer's data-located contact frame


def make_landmarker(with_masks):
    return mp_vision.PoseLandmarker.create_from_options(mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=4,  # umpire + catcher + batter + a fielder can all be in frame
        output_segmentation_masks=with_masks,
    ))


# Where the batter stands, in normalized frame coords, for this behind-the-plate
# footage. Seeding selection here matters: largest-bounding-box seeds on the UMPIRE
# (closest to camera) — verified against raw frames after the silhouette pass
# quietly rendered the umpire's raised-arms stance instead of Emily's swing.
BATTER_SEED = (0.40, 0.50)
TRACK_GATE = 0.10  # max normalized hip jump per frame; beyond this = detection lost


def hip_center(lms):
    return ((lms[L_HIP].x + lms[R_HIP].x) / 2, (lms[L_HIP].y + lms[R_HIP].y) / 2)


def make_tracker():
    """Batter selection: seed at the batter's-box position, then follow the nearest
    hip center frame to frame, gated so a lost detection (motion blur during the
    swing) freezes the track instead of snapping to the catcher or umpire."""
    state = {"prev": BATTER_SEED}

    def pick(result):
        px, py = state["prev"]
        idx = min(range(len(result.pose_landmarks)),
                  key=lambda i: (hip_center(result.pose_landmarks[i])[0] - px) ** 2 +
                                (hip_center(result.pose_landmarks[i])[1] - py) ** 2)
        hx, hy = hip_center(result.pose_landmarks[idx])
        if ((hx - px) ** 2 + (hy - py) ** 2) ** 0.5 > TRACK_GATE:
            return None  # nobody close enough to the tracked batter this frame
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
                # bi = None means the batter wasn't found this frame; callbacks
                # reuse their previous data so frame indexes stay aligned with
                # the source video (and with the 3D export)
                on_frame(bgr, result, pick(result))
            idx += 1
    cap.release()


def stroke(img, p1, p2, color, w):
    cv2.line(img, p1, p2, (*DARK, 255), w + 4, cv2.LINE_AA)
    cv2.line(img, p1, p2, (*color, 255), w, cv2.LINE_AA)


def main():
    video, start_s, end_s = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    out_dir = pathlib.Path(sys.argv[4])
    out_dir.mkdir(parents=True, exist_ok=True)

    # pass 1: fixed crop box from per-frame batter bounds, using percentiles so a
    # few jittered detections can't stretch the framing
    per_frame = []

    def collect(bgr, result, bi):
        if bi is None:
            return
        h, w = bgr.shape[:2]
        lms = result.pose_landmarks[bi]
        xs = [lms[i].x * w for i in ALL]
        ys = [lms[i].y * h for i in ALL]
        per_frame.append((min(xs), min(ys), max(xs), max(ys)))

    iterate(video, start_s, end_s, False, collect)
    arr = np.array(per_frame)
    left, top = np.percentile(arr[:, 0], 5), np.percentile(arr[:, 1], 5)
    right, bottom = np.percentile(arr[:, 2], 95), np.percentile(arr[:, 3], 95)
    bw, bh = right - left, bottom - top
    # generous top padding: the synthesized bat points up during the load
    x0 = int(max(0, left - bw * 0.20))
    x1 = int(right + bw * 0.20)
    y0 = int(max(0, top - bh * 0.30))
    y1 = int(bottom + bh * 0.08)
    print(f"crop box: x {x0}-{x1}, y {y0}-{y1}")

    # pass 2: silhouette + overlay render
    frames = []

    def render(bgr, result, bi):
        if bi is None:
            if frames:
                frames.append(frames[-1].copy())
            return
        h, w = bgr.shape[:2]
        lms = result.pose_landmarks[bi]
        mask = result.segmentation_masks[bi].numpy_view()

        # limit the mask to a padded box around the tracked batter so segmentation
        # bleed from other people on the field doesn't leave ghost blobs
        xs = [lms[i].x * w for i in ALL]
        ys = [lms[i].y * h for i in ALL]
        pad_x = (max(xs) - min(xs)) * 0.35
        pad_y = (max(ys) - min(ys)) * 0.25
        keep = np.zeros_like(mask)
        ky0, ky1 = int(max(0, min(ys) - pad_y)), int(min(h, max(ys) + pad_y))
        kx0, kx1 = int(max(0, min(xs) - pad_x)), int(min(w, max(xs) + pad_x))
        keep[ky0:ky1, kx0:kx1] = 1
        mask = mask * keep

        crop_mask = mask[y0:y1, x0:x1]
        ch, cw = crop_mask.shape[:2]
        rgba = np.zeros((ch, cw, 4), dtype=np.uint8)
        soft = cv2.GaussianBlur(np.clip(crop_mask, 0, 1), (5, 5), 0)
        rgba[..., 0] = SIL_BGR[0]
        rgba[..., 1] = SIL_BGR[1]
        rgba[..., 2] = SIL_BGR[2]
        rgba[..., 3] = (soft * 255).astype(np.uint8)

        def px(i):
            return (int(lms[i].x * w) - x0, int(lms[i].y * h) - y0)

        for a, b in TORSO:
            stroke(rgba, px(a), px(b), AMBER, 3)
        for a, b in LEGS:
            stroke(rgba, px(a), px(b), GREEN, 4)
        for a, b in ARMS:
            stroke(rgba, px(a), px(b), WHITE, 4)
        for i in [L_SH, R_SH, L_EL, R_EL, L_HIP, R_HIP, L_KN, R_KN, L_AN, R_AN]:
            cv2.circle(rgba, px(i), 5, (*DARK, 255), -1, cv2.LINE_AA)
            cv2.circle(rgba, px(i), 3, (*WHITE, 255), -1, cv2.LINE_AA)

        # synthesized bat: grip at wrist midpoint, along the average forearm direction
        lw, rw, le, re = px(L_WR), px(R_WR), px(L_EL), px(R_EL)
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
            if abs(len(frames) - CONTACT_FRAME) <= 3:
                bp = (int(grip[0] + fx * blen * 0.75), int(grip[1] + fy * blen * 0.75))
                cv2.circle(rgba, bp, 11, (*BALL, 255), -1, cv2.LINE_AA)
                cv2.circle(rgba, bp, 16, (*BALL, 255), 2, cv2.LINE_AA)

        # 360px + WebP q72: full frame rate (30fps) at a size that keeps the whole
        # sequence embeddable on the page (~2.7MB base64 for a 6s window) - PNG at
        # 460px ran ~10MB raw for the same window, too heavy for a mobile-friendly
        # page (project convention, see [[softball-scouting-report-format]]).
        target_w = 360
        scale = target_w / cw
        rgba = cv2.resize(rgba, (target_w, int(ch * scale)), interpolation=cv2.INTER_AREA)
        frames.append(rgba)

    iterate(video, start_s, end_s, True, render)

    total = 0
    for i, fr in enumerate(frames):
        p = out_dir / f"sil_{i:03d}.webp"
        cv2.imwrite(str(p), fr, [cv2.IMWRITE_WEBP_QUALITY, 72])
        total += p.stat().st_size
    print(f"{len(frames)} frames, {total/1e6:.2f} MB total, avg {total/len(frames)/1024:.0f} KB")


if __name__ == "__main__":
    main()
