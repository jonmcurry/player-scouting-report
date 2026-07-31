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
  0.5. Frame-rate decimation (decimate.py) - for unusually high-frame-rate
     uploads (240fps slow-mo and similar) over 120fps, subsamples down to
     ~30fps before the expensive stages run - lift_3d.py's VideoPose3D model
     has a fixed 243-frame receptive field baked into its pretrained
     weights, which means 8x less real-time context at 240fps than the
     ~30fps this pipeline's reference footage runs at. A pure no-op for
     every clip processed so far (~24-30fps).
  1. YOLO11-pose (person + COCO-17 2D pose) - substituted for RTMDet+RTMPose,
     which has no installable path in this environment (no mmcv wheel for
     this machine's torch/CUDA build, no local compiler toolchain to build
     one from source). Documented substitution, not a silent fallback.
     Before committing to a full per-frame pass, samples ~30 frames and
     bails out in seconds (not minutes) with a friendly, actionable message
     if nobody is clearly resolvable in the footage at all - see
     detect_2d.py's quick_trackability_check.
  2. YOLOv8 (COCO "baseball bat" class) + Ultralytics ByteTrack for bat
     tip/knob tracking.
  3. One-Euro filter on every keypoint and the bat tip/knob.
  4. VideoPose3D (2D COCO -> 3D H36M lift + coaching angles) - substituted
     for MotionBERT, whose checkpoint sits behind a non-scriptable OneDrive
     auth wall and expects Halpe-26 input instead of COCO-17.
  5. Contact-instant + summary-metric computation (metrics.py).
  5.5. Full-rate bat-speed refinement (refine_bat_speed.py) - only runs when
     Stage 0.5 decimated the input. Re-measures peak bat speed at the TRUE
     original frame rate in a short window around contact, from the
     ORIGINAL undecimated video - a cheap, bat-only pass (no full pose/3D-
     lift), since that's specifically what a high frame rate is good for.
     Purely additive to metrics.json - never replaces the decimated-cadence
     reading.
  6. Annotated overlay video for visual QA.

This is the DEFAULT path. The old pure-MediaPipe prototype
(scripts/pose_analyze.py) still exists, unused by default - see
scripts/pose3d/README.md for when/how to run it instead.

Usage: python run_pipeline.py <video_path> <out_dir>
"""
import sys
import json
import os
import pathlib
import time
import traceback

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import locate_swing
import decimate
import detect_2d
import lift_3d
import metrics as metrics_mod
import refine_bat_speed
import overlay


# Explicit status contract for the Node worker (src/cli/processUploadQueue.ts)
# that spawns this script - replaces having it infer success/failure from
# this process's raw exit code, which is unreliable: a real 1GB clip fully
# completed (metrics.json genuinely written, "phases" key present) and THEN
# crashed during Python's own interpreter teardown on a Windows/CUDA-driver
# combination (exit code 3221225794 / STATUS_DLL_INIT_FAILED, empty stderr) -
# a Python-level try/except cannot catch that, since it happens after this
# process's own code has already returned. So pipeline_status.json is written
# as literally the last action of a successful run() (or from the except
# handler below for a real in-pipeline failure), atomically (temp file +
# os.replace, so a kill/crash mid-write can never leave a half-written status
# file that would look validly parseable but be truncated) - Node reads only
# this file, never the exit code.
def write_status(out_dir, status, detail=None):
    payload = {"status": status, "detail": detail, "written_at": time.time()}
    tmp_path = pathlib.Path(out_dir) / "pipeline_status.json.tmp"
    final_path = pathlib.Path(out_dir) / "pipeline_status.json"
    tmp_path.write_text(json.dumps(payload, indent=2))
    os.replace(tmp_path, final_path)  # atomic on both POSIX and Windows (NTFS)


def run(video_path, out_dir):
    video_path = pathlib.Path(video_path)
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    print(f"=== pose3d pipeline: {video_path} -> {out_dir} ===")

    print("\n--- Stage 0/4: audio-based swing locate (locate_swing) ---")
    stage0 = locate_swing.run(video_path, out_dir)

    # Ordinarily a SINGLE window goes through Stages 0.5-3 below. But when
    # Stage 0 was ambiguous, it now hands back several ranked candidate
    # windows instead of committing to one on its own (a real clip proved
    # both "loudest audio" and "most motion" can each independently pick a
    # window with no real swing in it) - try them in rank order against the
    # REAL detector (metrics.py's own contact/phase logic) and keep the
    # first one that actually finds something, rather than trusting any
    # single cheap proxy's guess. MAX_CANDIDATE_ATTEMPTS bounds the worst
    # case (a genuinely hard clip where several candidates all fail) rather
    # than retrying without limit.
    candidates = stage0.get("candidate_windows") or [{
        "video_path_for_pipeline": stage0["video_path_for_pipeline"],
        "trim_start_s": stage0["trim_start_s"], "trim_end_s": stage0["trim_end_s"],
        "contact_estimate_s": stage0["contact_estimate_s"],
    }]
    MAX_CANDIDATE_ATTEMPTS = 3
    stage0_5 = None
    metrics_result = None
    low_quality_exc = None
    for attempt_i, candidate in enumerate(candidates[:MAX_CANDIDATE_ATTEMPTS]):
        analysis_video_path = pathlib.Path(candidate["video_path_for_pipeline"])
        attempt_label = f" (candidate {attempt_i + 1}/{min(len(candidates), MAX_CANDIDATE_ATTEMPTS)})" \
            if len(candidates) > 1 else ""

        print(f"\n--- Stage 0.5/4: frame-rate decimation (decimate){attempt_label} ---")
        # Same single-point-of-truth pattern as Stage 0 above - detect_2d/
        # lift_3d/metrics/overlay all get whichever video Stage 0.5 decided
        # on, decimated or unchanged, with zero code changes needed in those
        # four files. original_video_path (pre-decimation) is kept for Stage
        # 3.5's full-rate bat-speed refinement below.
        stage0_5 = decimate.run(analysis_video_path, out_dir)
        analysis_video_path = pathlib.Path(stage0_5["video_path_for_pipeline"])

        print(f"--- Stage 1/4: person + bat detection (detect_2d){attempt_label} ---")
        try:
            detect_2d.run(analysis_video_path, out_dir)
        except detect_2d.LowQualityFootageError as exc:
            low_quality_exc = exc
            print(f"[detect_2d] {exc}")
            continue  # try the next candidate rather than giving up on the whole clip

        print(f"--- Stage 2/4: 2D->3D lift + coaching angles (lift_3d){attempt_label} ---")
        lift_3d.run(out_dir / "pose_2d.json", out_dir)

        print(f"--- Stage 3/4: contact detection + summary metrics (metrics){attempt_label} ---")
        metrics_result = metrics_mod.run(out_dir)
        if metrics_result.get("phases"):
            if len(candidates) > 1:
                print(f"[run_pipeline] candidate {attempt_i + 1} found real phases - stopping here")
            break
        elif len(candidates) > 1 and attempt_i + 1 < min(len(candidates), MAX_CANDIDATE_ATTEMPTS):
            print(f"[run_pipeline] candidate {attempt_i + 1} found no phases ({metrics_result.get('error')}) "
                  f"- trying the next candidate")

    if metrics_result is None:
        # every attempted candidate raised LowQualityFootageError - same
        # honest early-stop shape detect_2d.py's own docstring describes,
        # using whichever candidate's exception was seen LAST (all attempted
        # candidates failed the same way, in practice, on real clips so far).
        (out_dir / "metrics.json").write_text(json.dumps({
            "clip": out_dir.name, "n_frames": None, "fps": None, "error": str(low_quality_exc),
        }, indent=2))
        dt = time.time() - t0
        print(f"\n=== Stopped early after {dt:.1f}s (low-quality footage). Output: {out_dir} ===")
        write_status(out_dir, "complete", {"outcome": "low_quality_footage", "error": str(low_quality_exc)})
        return

    if stage0_5["decimated"] and metrics_result.get("contact"):
        print("\n--- Stage 3.5/4: full-rate bat-speed refinement (refine_bat_speed) ---")
        refinement = refine_bat_speed.run(
            stage0_5["original_video_path"], out_dir, metrics_result["contact"]["time_s"])
        if refinement is not None:
            # Convert to the same body-relative unit (shoulder-widths/sec)
            # the rest of this pipeline uses - shoulder_px isn't persisted in
            # metrics.json, so recompute it the same cheap way metrics.py
            # itself does (a median over already-loaded 2D keypoints, no
            # model inference) rather than change that file's schema for
            # this one internal reconciliation step.
            pose_2d = json.loads((out_dir / "pose_2d.json").read_text())
            shoulder_px, _ = metrics_mod.body_scale_px(pose_2d["frames"])
            if shoulder_px:
                metrics_result["max_bat_speed_full_rate"] = {
                    "value": round(refinement["max_speed_px_per_s"] / shoulder_px, 3),
                    "unit": "shoulder-widths/sec; computed from a short full-"
                            f"{refinement['source_fps']:.1f}fps-rate bat-only tracking pass near "
                            "contact, NOT the decimated-cadence pose used for the rest of this "
                            "file - see run_pipeline.py's Stage 3.5 / decimate.py module docstring",
                    "source_fps": refinement["source_fps"],
                    "frame_full_rate": refinement["frame"],
                }
                (out_dir / "metrics.json").write_text(json.dumps(metrics_result, indent=2))
                print(f"[refine_bat_speed] wrote max_bat_speed_full_rate to metrics.json")

    print("\n--- Stage 4/4: annotated overlay for QA (overlay) ---")
    overlay.run(out_dir, analysis_video_path)

    dt = time.time() - t0
    print(f"\n=== Done in {dt:.1f}s. Output: {out_dir} ===")
    print(f"  Stage 0: {'trimmed' if stage0['trimmed'] else 'full-clip (fallback): ' + stage0['reason']}")
    print(f"  Stage 0.5: {'decimated ' + str(stage0_5['decimation_factor']) + 'x' if stage0_5['decimated'] else 'no-op: ' + stage0_5['reason']}")
    for name in ("pose_2d.json", "bat_path.json", "pose_3d.json", "metrics.json", "overlay.mp4"):
        p = out_dir / name
        print(f"  {'OK ' if p.exists() else 'MISSING'} {p}")

    # Last line of a successful run(), deliberately - see write_status's own
    # docstring on why this must be written before returning, not in a
    # `finally` up in __main__: a post-completion interpreter-teardown crash
    # happens strictly after this function returns, so anything placed here
    # still runs and is still trustworthy even when that crash follows.
    write_status(out_dir, "complete", {"outcome": "ok"})


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python run_pipeline.py <video_path> <out_dir>")
        sys.exit(1)
    _out_dir = sys.argv[2]
    try:
        run(sys.argv[1], _out_dir)
    except Exception as exc:
        # A genuine in-pipeline failure (as opposed to the post-completion
        # native crash write_status/module docstring above describes) -
        # write an explicit "crashed" status so the Node worker never has to
        # infer this from a missing file. Still re-raised so this process's
        # own exit code and stderr stay informative for a human tailing logs.
        try:
            write_status(_out_dir, "crashed", {"error": str(exc), "traceback": traceback.format_exc()})
        except OSError:
            pass  # out_dir may not even exist yet if the crash was that early
        raise
