"""
Stage 0.5 of the pose3d pipeline: for unusually high-frame-rate uploads
(240fps slow-mo and similar), subsample down to the cadence the rest of this
pipeline actually understands before the expensive stages run.

Why this exists: lift_3d.py's VideoPose3D model has a FIXED 243-frame
receptive field baked into its pretrained checkpoint weights - not a tunable
constant. At ~30fps (this pipeline's real reference footage) that's 8.1s of
real-time context; at 240fps it's only ~1.0s, since the model has no idea
frames are arriving 8x faster - it just sees 243 of them. Feeding it 240fps
input directly would mean it "understands" 8x less real swing context per
prediction than it was ever validated against. There's no way to retune this
away - the fix is decimating the input BACK DOWN to the cadence the model
actually knows, before Stage 1 (detect_2d) and Stage 2 (lift_3d) ever see it.

This deliberately does NOT throw away the extra temporal resolution
entirely - see refine_bat_speed.py (Stage 3.5), which runs a cheap,
bat-only pass on the ORIGINAL undecimated footage in a short window around
contact, specifically to get the more precise peak-bat-speed reading high
frame rate is actually good for. Decimation here is about giving the
pose/3D-lift stages input they were built for, not discarding the reason a
coach filmed at 240fps in the first place.

Every real clip processed by this pipeline so far has been ~24-30fps - this
stage is a pure no-op for all of them (no ffprobe/ffmpeg calls, doesn't touch
the video at all), same "opt-in speedup above a threshold" pattern
locate_swing.py's own MIN_DURATION_FOR_PREPASS_S already establishes.

Usage: python decimate.py <video_path> <out_dir>
  (writes out_dir/decimate.json and, if decimation ran,
  out_dir/_decimated_input.mp4)
"""
import sys
import json
import pathlib
import subprocess

# Clips at/under this fps pass through unchanged - matches every real clip
# processed by this pipeline so far (~24-30fps).
DECIMATION_SOURCE_FPS_THRESHOLD = 120.0
# The cadence lift_3d.py's VideoPose3D checkpoint was informally validated
# against (see this module's own docstring above).
DECIMATION_TARGET_FPS = 30.0


def _video_fps(video_path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=r_frame_rate", "-of", "default=noprint_wrappers=1:nokey=1",
         str(video_path)],
        capture_output=True, text=True,
    )
    num, _, den = out.stdout.strip().partition("/")
    return float(num) / float(den or 1)


def _video_duration_s(video_path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
        capture_output=True, text=True,
    )
    return float(out.stdout.strip())


def _no_decimation(video_path, reason):
    return {
        "decimated": False,
        "reason": reason,
        "video_path_for_pipeline": str(video_path),
        "original_video_path": str(video_path),
        "source_fps": None,
        "decimation_factor": None,
        "effective_fps": None,
    }


def run(video_path, out_dir):
    video_path = pathlib.Path(video_path)
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        source_fps = _video_fps(video_path)
    except (ValueError, ZeroDivisionError, subprocess.SubprocessError) as exc:
        result = _no_decimation(video_path, f"could not read source fps ({exc})")
        (out_dir / "decimate.json").write_text(json.dumps(result, indent=2))
        return result

    print(f"[decimate] {video_path.name}: source_fps={source_fps:.2f} "
          f"(threshold={DECIMATION_SOURCE_FPS_THRESHOLD})")
    if source_fps <= DECIMATION_SOURCE_FPS_THRESHOLD:
        result = _no_decimation(video_path, f"source fps {source_fps:.2f} at/under threshold")
        print(f"[decimate] {result['reason']} - no decimation")
        (out_dir / "decimate.json").write_text(json.dumps(result, indent=2))
        return result

    decimation_factor = max(1, round(source_fps / DECIMATION_TARGET_FPS))
    effective_fps = source_fps / decimation_factor
    decimated_path = out_dir / "_decimated_input.mp4"

    # Deterministic frame-INDEX subsampling (select=not(mod(n,factor))), not a
    # naive `-r <target>`-only re-encode - the latter re-times frames by
    # PRESENTATION TIMESTAMP, which can duplicate/drop frames unevenly and
    # drift from a clean 1-in-N sample. -vsync vfr keeps only the selected
    # frames' own timestamps, avoiding artificial duplication.
    print(f"[decimate] decimating by {decimation_factor}x -> effective {effective_fps:.2f}fps")
    select_expr = f"select='not(mod(n\\,{decimation_factor}))'"
    result_proc = subprocess.run(
        ["ffmpeg", "-y", "-i", str(video_path), "-vf", select_expr,
         "-vsync", "vfr", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
         "-pix_fmt", "yuv420p", str(decimated_path)],
        capture_output=True, text=True,
    )
    if result_proc.returncode != 0 or not decimated_path.exists():
        result = _no_decimation(video_path, "ffmpeg decimation failed")
        print(f"[decimate] {result['reason']} - falling back to original clip")
        (out_dir / "decimate.json").write_text(json.dumps(result, indent=2))
        return result

    result = {
        "decimated": True,
        "reason": f"source fps {source_fps:.2f} over threshold, decimated {decimation_factor}x",
        "video_path_for_pipeline": str(decimated_path),
        "original_video_path": str(video_path),
        "source_fps": source_fps,
        "decimation_factor": decimation_factor,
        "effective_fps": effective_fps,
    }
    print(f"[decimate] wrote {decimated_path}")
    (out_dir / "decimate.json").write_text(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python decimate.py <video_path> <out_dir>")
        sys.exit(1)
    run(sys.argv[1], sys.argv[2])
