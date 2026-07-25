"""
Export MediaPipe 3D world landmarks for a time window of a swing clip, as JSON
for embedding into the interactive 3D swing-model viewer page.

pose_analyze.py reduces each frame to a few derived angles; this exports the raw
3D skeleton instead (a subset of joints), so the viewer can replay the actual
swing as an animated skeleton. Coordinates are MediaPipe world landmarks: meters,
origin at the hip midpoint, x right / y down / z toward camera.

Usage: python pose_export_3d.py <input_video> <start_s> <end_s> <out_json>
"""
import sys
import json
import pathlib

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

MODEL_PATH = pathlib.Path(__file__).parent / "models" / "pose_landmarker_full.task"

# Where the batter stands, in normalized frame coords, for this behind-the-plate
# footage. Matches pose_silhouette.py's BATTER_SEED / TRACK_GATE - keep both in
# sync if either script's seed changes, since they must track the same person to
# stay frame-aligned with each other.
BATTER_SEED = (0.40, 0.50)
TRACK_GATE = 0.10

# Subset of BlazePose's 33 landmarks that draws a clean skeleton
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


def main():
    video_path, start_s, end_s, out_json = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]

    base_options = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
    options = mp_vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=4,  # umpire + catcher + batter + a fielder can all be in frame
    )

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    frame_idx = 0
    prev_hip = [BATTER_SEED[0], BATTER_SEED[1]]

    with mp_vision.PoseLandmarker.create_from_options(options) as landmarker:
        while True:
            ok, frame_bgr = cap.read()
            if not ok:
                break
            t = frame_idx / fps
            # VIDEO mode needs monotonically increasing timestamps, so decode from
            # the start rather than seeking; only frames in-window get exported.
            if t <= end_s:
                if t >= start_s:
                    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
                    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
                    result = landmarker.detect_for_video(mp_image, int(t * 1000))
                    if result.pose_world_landmarks:
                        # Batter selection: seed at the batter's-box position and follow
                        # the nearest hip center, gated. Largest-bounding-box seeds on
                        # the UMPIRE (closest to camera) in this footage - verified
                        # against raw frames - and a lost detection during swing blur
                        # must freeze the track, not snap to the catcher.
                        def hip(lms):
                            return ((lms[23].x + lms[24].x) / 2, (lms[23].y + lms[24].y) / 2)
                        px, py = prev_hip
                        idx = min(range(len(result.pose_landmarks)),
                                  key=lambda i: (hip(result.pose_landmarks[i])[0] - px) ** 2 +
                                                (hip(result.pose_landmarks[i])[1] - py) ** 2)
                        hx, hy = hip(result.pose_landmarks[idx])
                        if ((hx - px) ** 2 + (hy - py) ** 2) ** 0.5 > TRACK_GATE:
                            # batter not found this frame - duplicate the previous frame
                            # so indexes stay aligned with the source video
                            if frames:
                                frames.append({"t": round(t, 3), "joints": frames[-1]["joints"]})
                        else:
                            prev_hip[0], prev_hip[1] = hx, hy
                            wl = result.pose_world_landmarks[idx]
                            frames.append({
                                "t": round(t, 3),
                                "joints": {name: [round(wl[i].x, 3), round(wl[i].y, 3), round(wl[i].z, 3)]
                                           for name, i in JOINTS.items()},
                            })
                else:
                    # still must feed the landmarker to keep its tracking state warm
                    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
                    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
                    landmarker.detect_for_video(mp_image, int(t * 1000))
            else:
                break
            frame_idx += 1

    cap.release()

    # 3-frame moving average to damp per-frame detection jitter before display
    smoothed = []
    for i, fr in enumerate(frames):
        window = frames[max(0, i - 1):i + 2]
        joints = {}
        for name in JOINTS:
            joints[name] = [round(sum(w["joints"][name][k] for w in window) / len(window), 3)
                            for k in range(3)]
        smoothed.append({"t": fr["t"], "joints": joints})

    with open(out_json, "w") as f:
        json.dump({"fps": round(fps, 2), "frames": smoothed}, f)
    print(f"Exported {len(smoothed)} frames ({start_s}s-{end_s}s) to {out_json}")


if __name__ == "__main__":
    main()
