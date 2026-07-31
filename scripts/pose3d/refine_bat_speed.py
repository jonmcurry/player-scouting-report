"""
Stage 3.5 of the pose3d pipeline: for clips that went through Stage 0.5's
frame-rate decimation, re-measures peak bat speed at the TRUE original frame
rate in a short window around the already-found contact instant - the
specific thing a high frame rate is actually useful for (a decimated-to-30fps
cadence can under-sample a fast bat's true peak speed between sampled
frames, which is exactly why a coach would film at 240fps in the first
place - see decimate.py's own module docstring).

Runs ONLY a bat-detection pass (no full pose/3D-lift) over a short (~1s)
clip extracted from the ORIGINAL undecimated video - cheap, since it skips
both the expensive YOLO11-pose pass and the VideoPose3D lift entirely.
Reuses metrics.py's own bat_speeds() finite-difference formula, just fed
frames measured at the true source fps instead of the decimated cadence.

Simplification, stated honestly: within this narrow, precisely-centered
window, this picks the highest-confidence bat detection per frame rather
than running detect_2d.py's fuller wrist-proximity/track-continuity logic
(that logic exists specifically to survive a WHOLE at-bat's worth of
catcher/umpire confusion - a problem this short, already-centered window is
much less exposed to). Only ever runs as an ADDITIVE refinement on top of
the decimated-cadence result already in metrics.json - never a replacement,
and skipped entirely (returning None) rather than reporting an unreliable
number if nothing tracks in the window.

Usage: python refine_bat_speed.py <original_video_path> <out_dir> <contact_time_s>
"""
import sys
import pathlib
import subprocess

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from detect_2d import DET_MODEL, BAT_CLASS_ID, bat_tip_and_knob, _cuda_available
import metrics as metrics_mod

# Reuses metrics.py's own ALIGNMENT_TOLERANCE_S-derived window size (its
# max_bat_speed search is +-1.0s around contact) rather than a new,
# separately-tuned value.
WINDOW_PRE_S = 0.5
WINDOW_POST_S = 0.5


def run(original_video_path, out_dir, contact_time_s):
    import cv2
    from ultralytics import YOLO

    original_video_path = pathlib.Path(original_video_path)
    out_dir = pathlib.Path(out_dir)

    start_s = max(0.0, contact_time_s - WINDOW_PRE_S)
    duration_s = WINDOW_PRE_S + WINDOW_POST_S
    window_path = out_dir / "_full_rate_window.mp4"

    print(f"[refine_bat_speed] extracting full-rate window [{start_s:.2f}s, "
          f"{start_s + duration_s:.2f}s] from original upload")
    result_proc = subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{start_s:.3f}", "-i", str(original_video_path),
         "-t", f"{duration_s:.3f}", "-an", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "18", "-pix_fmt", "yuv420p", str(window_path)],
        capture_output=True, text=True,
    )
    if result_proc.returncode != 0 or not window_path.exists():
        print("[refine_bat_speed] failed to extract full-rate window - skipping refinement")
        return None

    cap = cv2.VideoCapture(str(window_path))
    source_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()

    bat_model = YOLO(str(DET_MODEL))
    device = 0 if _cuda_available() else "cpu"
    bat_results = bat_model.track(
        source=str(window_path), stream=True, verbose=False,
        conf=0.15, classes=[BAT_CLASS_ID], tracker="bytetrack.yaml",
        persist=True, device=device,
    )

    bat_frames = []
    for r in bat_results:
        entry = {"tip": None, "knob": None}
        if r.boxes is not None and len(r.boxes) > 0:
            xyxy = r.boxes.xyxy.cpu().numpy()
            conf = r.boxes.conf.cpu().numpy()
            best_idx = int(conf.argmax())
            box = tuple(xyxy[best_idx])
            # No hand reference at this stage (no pose pass ran) - tip/knob
            # order is arbitrary as a result, which only matters for
            # direction-sensitive readings (attack angle); bat_speeds() below
            # only uses tip-to-tip displacement magnitude, which is
            # order-independent, so this is fine for this narrow purpose.
            tip, knob = bat_tip_and_knob(box, [])
            entry = {"tip": tip, "knob": knob}
        bat_frames.append(entry)

    speeds = metrics_mod.bat_speeds(bat_frames, source_fps)
    tracked_speeds = [s for s in speeds if s is not None]
    if not tracked_speeds:
        print("[refine_bat_speed] no tracked bat-tip speed in full-rate window - "
              "skipping refinement")
        return None

    max_speed_px = max(tracked_speeds)
    max_speed_frame = speeds.index(max_speed_px)
    print(f"[refine_bat_speed] full-rate ({source_fps:.1f}fps) peak bat speed found at "
          f"frame {max_speed_frame} of the {duration_s:.1f}s window")
    return {"max_speed_px_per_s": max_speed_px, "source_fps": source_fps, "frame": max_speed_frame}


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python refine_bat_speed.py <original_video_path> <out_dir> <contact_time_s>")
        sys.exit(1)
    run(sys.argv[1], sys.argv[2], float(sys.argv[3]))
