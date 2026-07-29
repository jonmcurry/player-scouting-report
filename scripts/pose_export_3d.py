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

import numpy as np
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

from pose_common import JOINTS, make_tracker

MODEL_PATH = pathlib.Path(__file__).parent / "models" / "pose_landmarker_full.task"


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
    pick = make_tracker()

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
                        # the nearest hip center, gated (see pose_common.make_tracker) -
                        # NOT largest-bounding-box, which locks onto the UMPIRE (closest
                        # to camera) in this footage - verified against raw frames.
                        idx = pick(result.pose_landmarks)
                        if idx is None:
                            # batter not found this frame - duplicate the previous frame
                            # so indexes stay aligned with the source video
                            if frames:
                                frames.append({"t": round(t, 3), "joints": frames[-1]["joints"]})
                        else:
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

    # Savitzky-Golay filter per joint per axis, not a plain moving-average: a
    # flat 3-frame average left real, visible jitter in - measured directly
    # against the exported data, frame-to-frame joint movement during frames
    # she's just standing in the load (not really moving) was 3-25cm, similar
    # in size to her real wrist movement DURING the swing itself. That's noise
    # in MediaPipe's monocular 3D depth estimate, not real motion, and it's
    # what read as "jerky, doesn't flow like a real swing" once rendered as
    # solid capsules instead of a soft blurred silhouette (which had been
    # hiding it). A Savitzky-Golay fit (locally fits a polynomial per window,
    # here quadratic) removes noise like this without the lag/over-blur a
    # plain box average gets at this window size, so the real swing keeps its
    # snap while the noise floor drops out.
    # A plain Savitzky-Golay pass alone barely helped (checked: ~10% delta
    # reduction) - traced why by dumping the raw per-frame wrist trajectory and
    # found the noise isn't continuous jitter, it's occasional gross OUTLIER
    # SPIKES (one frame's wrist position miles from the trend, then snapping
    # back next frame - a bad single-frame detection, not real motion). A
    # polynomial fit still gets pulled toward an outlier sitting in its window;
    # a median filter rejects it outright instead of blending it in. Median
    # first, then Savitzky-Golay for the final fluid motion.
    from scipy.signal import savgol_filter, medfilt
    polyorder = 2
    window = min(9, len(frames))
    if window % 2 == 0:
        window -= 1  # savgol_filter requires an odd window length
    med_kernel = min(7, window if window % 2 == 1 else window - 1)
    joint_names = list(JOINTS.keys())
    arr = np.array([[fr["joints"][name] for name in joint_names] for fr in frames])  # (T, J, 3)
    median_arr = medfilt(arr, kernel_size=(med_kernel, 1, 1))
    smoothed_arr = savgol_filter(median_arr, window_length=window, polyorder=polyorder, axis=0, mode="nearest")
    smoothed = []
    for i, fr in enumerate(frames):
        joints = {name: [round(float(v), 3) for v in smoothed_arr[i, j]]
                  for j, name in enumerate(joint_names)}
        smoothed.append({"t": fr["t"], "joints": joints})

    with open(out_json, "w") as f:
        json.dump({"fps": round(fps, 2), "frames": smoothed}, f)
    print(f"Exported {len(smoothed)} frames ({start_s}s-{end_s}s) to {out_json}")


if __name__ == "__main__":
    main()
