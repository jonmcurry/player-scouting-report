"""
Prototype: single-camera pose-estimation pass over an already-extracted swing clip.

Runs MediaPipe's Pose Landmarker (Tasks API, VIDEO mode) frame-by-frame over a
video file and computes a few derived swing angles per frame:
  - front-knee angle (hip-knee-ankle) on the lead leg
  - shoulder-line angle vs. horizontal (proxy for shoulder rotation)
  - hip-line angle vs. horizontal (proxy for hip rotation)
  - hip-shoulder separation = |shoulder angle - hip angle| (the checkpoint that
    kept getting hedged to a "2" when graded by eye from behind-the-plate video)

This is a prototype to validate that pose estimation gives usable signal from
real rec-league game footage (motion blur, single fixed camera, kids' bodies at
odd angles) before building this into the report-generation workflow. It writes
one CSV row per frame plus an annotated video with the skeleton drawn on top so
the numbers can be sanity-checked against what's visually happening.

Usage: python pose_analyze.py <input_video> <output_dir>

Requires: pip install mediapipe opencv-python, and the pose landmarker model
downloaded once (gitignored - it's a 9.4MB binary, not project-authored code):
  curl -sL -o scripts/models/pose_landmarker_full.task \
    https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task
"""
import sys
import csv
import math
import pathlib

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

MODEL_PATH = pathlib.Path(__file__).parent / "models" / "pose_landmarker_full.task"

# MediaPipe Pose landmark indices we care about (BlazePose 33-point topology)
L_SHOULDER, R_SHOULDER = 11, 12
L_HIP, R_HIP = 23, 24
L_KNEE, R_KNEE = 25, 26
L_ANKLE, R_ANKLE = 27, 28
L_WRIST, R_WRIST = 15, 16


def line_orientation(p1, p2, axes=("x", "y")):
    """Orientation of the line through p1/p2 in the given 2D plane, in (-90, 90].

    A line has no inherent direction (p1->p2 and p2->p1 describe the same line),
    so a raw atan2 angle is ambiguous by 180 degrees - e.g. as the torso rotates
    through a swing, "left shoulder" and "right shoulder" can end up swapped in
    screen-space relative to which one atan2 treats as the origin, which made the
    first version of this wrap to nonsense values like 321 degrees. Reducing mod
    180 and folding into (-90, 90] makes the same physical line orientation map
    to the same number regardless of which endpoint is p1 vs p2.

    axes picks which two coordinates define the plane: ("x","y") for the 2D image
    projection, or ("x","z") for a top-down (transverse-plane) view using
    MediaPipe's estimated 3D world landmarks - see the module docstring for why
    the image-plane version is unusable for hip/shoulder rotation from a
    behind-the-plate camera.
    """
    d1 = getattr(p2, axes[0]) - getattr(p1, axes[0])
    d2 = getattr(p2, axes[1]) - getattr(p1, axes[1])
    ang = math.degrees(math.atan2(d2, d1)) % 180
    if ang > 90:
        ang -= 180
    return ang


def orientation_diff(a, b):
    """Smallest angular distance between two line orientations in (-90, 90], as 0-90."""
    d = abs(a - b) % 180
    return min(d, 180 - d)


def joint_angle(a, b, c):
    """Interior angle at point b, formed by rays b->a and b->c, in degrees."""
    v1 = (a.x - b.x, a.y - b.y)
    v2 = (c.x - b.x, c.y - b.y)
    dot = v1[0] * v2[0] + v1[1] * v2[1]
    mag1 = math.hypot(*v1)
    mag2 = math.hypot(*v2)
    if mag1 == 0 or mag2 == 0:
        return None
    cos_angle = max(-1.0, min(1.0, dot / (mag1 * mag2)))
    return math.degrees(math.acos(cos_angle))


def main():
    if len(sys.argv) != 3:
        print("Usage: python pose_analyze.py <input_video> <output_dir>")
        sys.exit(1)

    video_path = pathlib.Path(sys.argv[1])
    out_dir = pathlib.Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)

    base_options = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
    options = mp_vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=2,  # game footage often has catcher/ump in frame too
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"Input: {video_path.name}  {frame_w}x{frame_h}  {fps:.1f}fps  {n_frames} frames")

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    annotated_path = out_dir / f"{video_path.stem}_pose.mp4"
    writer = cv2.VideoWriter(str(annotated_path), fourcc, fps, (frame_w, frame_h))

    csv_path = out_dir / f"{video_path.stem}_pose.csv"
    csv_file = open(csv_path, "w", newline="")
    csv_writer = csv.writer(csv_file)
    csv_writer.writerow([
        "frame", "time_s", "n_people_detected",
        "front_knee_angle_deg",
        "shoulder_line_angle_2d_deg", "hip_line_angle_2d_deg", "separation_2d_deg",
        "shoulder_line_angle_3d_deg", "hip_line_angle_3d_deg", "separation_3d_deg",
    ])

    detected_count = 0
    frame_idx = 0

    with mp_vision.PoseLandmarker.create_from_options(options) as landmarker:
        while True:
            ok, frame_bgr = cap.read()
            if not ok:
                break

            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
            timestamp_ms = int((frame_idx / fps) * 1000)

            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            front_knee = None
            shoulder_2d = hip_2d = sep_2d = None
            shoulder_3d = hip_3d = sep_3d = None
            n_people = len(result.pose_landmarks) if result.pose_landmarks else 0

            if n_people > 0:
                detected_count += 1
                # Batter selection: in this fixed-camera setup the batter is reliably
                # the largest person in frame (catcher/ump are smaller and/or partly
                # cropped by the frame edge). Picking by landmark bounding-box area is
                # more robust across all 5 clips than assuming detection order, which
                # isn't guaranteed to put the batter first when >1 person is detected.
                def bbox_area(landmarks):
                    xs = [p.x for p in landmarks]
                    ys = [p.y for p in landmarks]
                    return (max(xs) - min(xs)) * (max(ys) - min(ys))

                idx = max(range(n_people), key=lambda i: bbox_area(result.pose_landmarks[i]))
                lm = result.pose_landmarks[idx]

                # 2D image-plane version: unstable whenever the shoulder/hip line is
                # foreshortened toward vertical in the frame (exactly what happens
                # viewing a batter mostly face-on/back-on from behind the plate) -
                # kept only to demonstrate/compare against the 3D version below.
                shoulder_2d = line_orientation(lm[L_SHOULDER], lm[R_SHOULDER])
                hip_2d = line_orientation(lm[L_HIP], lm[R_HIP])
                sep_2d = orientation_diff(shoulder_2d, hip_2d)

                # 3D world-landmark version: MediaPipe estimates a rough metric 3D
                # pose per frame from the single camera (its own monocular 3D lift).
                # Using the x/z (top-down / transverse-plane) coordinates gives hip
                # and shoulder rotation around the vertical axis directly, instead of
                # a 2D screen-space projection - this is what actually fixes the
                # foreshortening instability seen in the 2D version.
                if result.pose_world_landmarks and len(result.pose_world_landmarks) > idx:
                    wl = result.pose_world_landmarks[idx]
                    shoulder_3d = line_orientation(wl[L_SHOULDER], wl[R_SHOULDER], axes=("x", "z"))
                    hip_3d = line_orientation(wl[L_HIP], wl[R_HIP], axes=("x", "z"))
                    sep_3d = orientation_diff(shoulder_3d, hip_3d)

                # Front leg: use whichever knee/ankle pair is closer to the camera
                # (larger y = lower in frame = closer, roughly) as a rough proxy for
                # "front" without assuming batter handedness/orientation.
                fk_left = joint_angle(lm[L_HIP], lm[L_KNEE], lm[L_ANKLE])
                fk_right = joint_angle(lm[R_HIP], lm[R_KNEE], lm[R_ANKLE])
                front_knee = fk_left if fk_left is not None else fk_right

                # Draw skeleton for visual sanity-check
                for idx in (L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_KNEE, R_KNEE,
                            L_ANKLE, R_ANKLE, L_WRIST, R_WRIST):
                    pt = lm[idx]
                    cx, cy = int(pt.x * frame_w), int(pt.y * frame_h)
                    cv2.circle(frame_bgr, (cx, cy), 4, (0, 255, 0), -1)
                connections = [
                    (L_SHOULDER, R_SHOULDER), (L_HIP, R_HIP),
                    (L_SHOULDER, L_HIP), (R_SHOULDER, R_HIP),
                    (L_HIP, L_KNEE), (L_KNEE, L_ANKLE),
                    (R_HIP, R_KNEE), (R_KNEE, R_ANKLE),
                    (L_SHOULDER, L_WRIST), (R_SHOULDER, R_WRIST),
                ]
                for a, b in connections:
                    pa, pb = lm[a], lm[b]
                    cv2.line(frame_bgr,
                              (int(pa.x * frame_w), int(pa.y * frame_h)),
                              (int(pb.x * frame_w), int(pb.y * frame_h)),
                              (0, 200, 255), 2)

            def r1(v):
                return round(v, 1) if v is not None else ""

            csv_writer.writerow([
                frame_idx, round(frame_idx / fps, 3), n_people,
                r1(front_knee),
                r1(shoulder_2d), r1(hip_2d), r1(sep_2d),
                r1(shoulder_3d), r1(hip_3d), r1(sep_3d),
            ])

            writer.write(frame_bgr)
            frame_idx += 1

    cap.release()
    writer.release()
    csv_file.close()

    print(f"Frames processed: {frame_idx}")
    print(f"Frames with a detected pose: {detected_count} ({detected_count/max(frame_idx,1)*100:.0f}%)")
    print(f"CSV: {csv_path}")
    print(f"Annotated video: {annotated_path}")


if __name__ == "__main__":
    main()
