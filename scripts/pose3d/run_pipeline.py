"""
Main orchestrator for the replacement pose/bat/3D-lift analysis pipeline.
Runs all four stages against one video and writes the full output set the
I/O contract specifies under frames/<player_slug>/<clip_stem>/:
  pose_2d.json, bat_path.json, pose_3d.json, metrics.json, overlay.mp4

Stack (see scripts/pose3d/README.md for the full rationale + install notes):
  0. Audio-based swing locate (locate_swing.py) - for clips over 60s, cheaply
     finds roughly where bat-ball contact happens via a bat-crack onset in
     the audio track, and trims to a short window around it so stages 1-4
     below only analyze that window instead of the whole clip. Falls back
     to the original full clip whenever the audio signal is missing, silent,
     or ambiguous - never guesses a wrong window.
  1. YOLO11-pose (person + COCO-17 2D pose) - substituted for RTMDet+RTMPose,
     which has no installable path in this environment (no mmcv wheel for
     this machine's torch/CUDA build, no local compiler toolchain to build
     one from source). Documented substitution, not a silent fallback.
  2. YOLOv8 (COCO "baseball bat" class) + Ultralytics ByteTrack for bat
     tip/knob tracking.
  3. One-Euro filter on every keypoint and the bat tip/knob.
  4. VideoPose3D (2D COCO -> 3D H36M lift + coaching angles) - substituted
     for MotionBERT, whose checkpoint sits behind a non-scriptable OneDrive
     auth wall and expects Halpe-26 input instead of COCO-17.
  5. Contact-instant + summary-metric computation (metrics.py).
  6. Annotated overlay video for visual QA.

This is the DEFAULT path. The old pure-MediaPipe prototype
(scripts/pose_analyze.py) still exists, unused by default - see
scripts/pose3d/README.md for when/how to run it instead.

Usage: python run_pipeline.py <video_path> <out_dir>
"""
import sys
import pathlib
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import locate_swing
import detect_2d
import lift_3d
import metrics as metrics_mod
import overlay


def run(video_path, out_dir):
    video_path = pathlib.Path(video_path)
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    print(f"=== pose3d pipeline: {video_path} -> {out_dir} ===")

    print("\n--- Stage 0/4: audio-based swing locate (locate_swing) ---")
    stage0 = locate_swing.run(video_path, out_dir)
    # analysis_video_path is resolved exactly once here and passed unchanged
    # to both detect_2d.run() and overlay.run() below - the single point of
    # truth that keeps their frame indices aligned, whether Stage 0 trimmed
    # or fell back to the original upload.
    analysis_video_path = pathlib.Path(stage0["video_path_for_pipeline"])

    print("\n--- Stage 1/4: person + bat detection (detect_2d) ---")
    detect_2d.run(analysis_video_path, out_dir)

    print("\n--- Stage 2/4: 2D->3D lift + coaching angles (lift_3d) ---")
    lift_3d.run(out_dir / "pose_2d.json", out_dir)

    print("\n--- Stage 3/4: contact detection + summary metrics (metrics) ---")
    metrics_mod.run(out_dir)

    print("\n--- Stage 4/4: annotated overlay for QA (overlay) ---")
    overlay.run(out_dir, analysis_video_path)

    dt = time.time() - t0
    print(f"\n=== Done in {dt:.1f}s. Output: {out_dir} ===")
    print(f"  Stage 0: {'trimmed' if stage0['trimmed'] else 'full-clip (fallback): ' + stage0['reason']}")
    for name in ("pose_2d.json", "bat_path.json", "pose_3d.json", "metrics.json", "overlay.mp4"):
        p = out_dir / name
        print(f"  {'OK ' if p.exists() else 'MISSING'} {p}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python run_pipeline.py <video_path> <out_dir>")
        sys.exit(1)
    run(sys.argv[1], sys.argv[2])
