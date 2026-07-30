"""
Stage 0 of the pose3d pipeline: cheaply locate roughly where bat-ball contact
happens in a long raw upload, so the expensive stages (detect_2d's two full
YOLO passes) only need to analyze a short window around it instead of the
whole clip.

Real coach uploads are full continuous at-bat recordings (walk-up, multiple
pitches, foul balls, dead time between pitches), not pre-trimmed single-swing
clips - confirmed on real data that a full at-bat clip can be minutes long
with the actual swing occupying a tiny fraction of it (see metrics.py's
phase_search_window docstring, and Emily_C_AB1_game2: a 465s upload where only
0.6% of frames had any tracked batter pose at all).

Approach: audio-based bat-crack onset detection, not vision. A cheaper/faster
vision pass (smaller model, downscaled frames) was considered and rejected -
if the full-resolution model already can't track a small/blurry batter, a
lighter model run over the same footage has no reason to do better at finding
the window in the first place. Audio doesn't depend on visual
resolution/focus at all, so it isn't subject to that same blind spot.

Honesty stance (same as metrics.py's contact/phase detectors): never guess a
wrong window. Every condition below that isn't a clean, confident, isolated
onset falls back to handing the ORIGINAL unmodified video path back to the
caller - identical to today's existing full-clip behavior - rather than risk
silently trimming away the real swing. A confidently-wrong trim is far worse
than no speedup at all.

Usage: python locate_swing.py <video_path> <out_dir>
  (writes out_dir/stage0.json and, if a confident trim is made,
  out_dir/_trimmed_input.mp4)
"""
import sys
import json
import pathlib
import subprocess

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt, find_peaks

# Clips shorter than this never invoke any of the logic below (no ffprobe/
# ffmpeg calls at all) - comfortably above the longest known-good clip
# observed in this repo (Emily_C_AB1 (4), ~42s), so every currently-working
# short clip never touches this new code path. This is the primary
# regression guarantee: Stage 0 is a pure opt-in speedup for long clips.
MIN_DURATION_FOR_PREPASS_S = 60.0

# Margins around the detected contact instant, clamped to the clip's own
# duration. 2x the largest existing backward phase-search window
# (find_stance_frame, 3.0s) and 2x the largest forward one
# (find_follow_through_frame, 3.0s) in metrics.py - a clean 100% safety
# margin on both sides, plus slack for detect_2d.py's own MIN_TRACK_LEN=15
# frame track warm-up before it can select a batter track.
PRE_MARGIN_S = 6.0
POST_MARGIN_S = 6.0

AUDIO_SAMPLE_RATE = 16000  # Nyquist 8kHz preserves a crack's diagnostic
                           # 2-8kHz content; whole array stays tiny (a 465s
                           # clip is 7.44M float32 samples - processes in
                           # well under a second, no chunking needed).
SILENCE_FLOOR = 0.02       # max abs amplitude below this = no usable signal
                           # at all (2% of full scale) - guards against a
                           # near-silent/muted track normalizing into a
                           # fake-looking confident peak later.
HIGHPASS_HZ = 1000         # crowd/wind/voice energy sits mostly below this;
                           # a bat-ball impact's short attack skews energy
                           # above it - simple time-domain bias toward
                           # "sharp transient" without FFT/spectral-flux.
ONSET_FRAME_S = 0.064      # 64ms short-time energy window
ONSET_HOP_S = 0.016        # 16ms hop
PEAK_HEIGHT = 0.5          # must reach at least half this clip's own dynamic range
PEAK_PROMINENCE = 0.3      # must stand out from its local baseline
PEAK_MIN_DISTANCE_S = 1.0  # candidate onsets must be at least this far apart
AMBIGUITY_MARGIN = 0.15    # top vs. second-best normalized height must
                           # differ by at least this much, or treat as
                           # ambiguous (e.g. a foul ball plus the real
                           # contact) and fall back rather than guess.


def _fallback(reason, video_path):
    print(f"[locate_swing] {reason} - full clip")
    return {
        "ran": True,
        "trimmed": False,
        "reason": reason,
        "video_path_for_pipeline": str(video_path),
        "contact_estimate_s": None,
        "trim_start_s": None,
        "trim_end_s": None,
        "trimmed_path": None,
    }


def _skip(video_path):
    return {
        "ran": False,
        "trimmed": False,
        "reason": f"clip under {MIN_DURATION_FOR_PREPASS_S}s pre-pass threshold",
        "video_path_for_pipeline": str(video_path),
        "contact_estimate_s": None,
        "trim_start_s": None,
        "trim_end_s": None,
        "trimmed_path": None,
    }


def video_duration_s(video_path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
        capture_output=True, text=True,
    )
    return float(out.stdout.strip())


def has_audio_stream(video_path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=index", "-of", "csv=p=0", str(video_path)],
        capture_output=True, text=True,
    )
    return bool(out.stdout.strip())


def extract_audio(video_path, wav_path):
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(video_path), "-vn", "-ac", "1",
         "-ar", str(AUDIO_SAMPLE_RATE), "-f", "wav", str(wav_path)],
        capture_output=True, text=True,
    )
    return result.returncode == 0 and wav_path.exists() and wav_path.stat().st_size > 0


def onset_strength_series(wav_path):
    """Zero-phase high-pass (so peak timing isn't shifted) + short-time RMS
    energy envelope, min-max normalized to [0,1] - same normalization
    pattern metrics.py already uses for its own bat-speed/knee/rotation
    signals. Returns (onset_norm, hop_samples, sample_rate, max_abs_amplitude)."""
    sr, samples = wavfile.read(wav_path)
    x = samples.astype(np.float32)
    x = x / (np.iinfo(samples.dtype).max if np.issubdtype(samples.dtype, np.integer) else 1.0)
    max_abs = float(np.max(np.abs(x))) if len(x) else 0.0

    sos = butter(4, HIGHPASS_HZ, btype="highpass", fs=sr, output="sos")
    x_hp = sosfiltfilt(sos, x)

    frame = int(round(ONSET_FRAME_S * sr))
    hop = int(round(ONSET_HOP_S * sr))
    n_windows = max(0, (len(x_hp) - frame) // hop)
    onset = np.array([
        np.sqrt(np.mean(x_hp[i * hop: i * hop + frame] ** 2))
        for i in range(n_windows)
    ])
    if len(onset) == 0 or onset.max() == onset.min():
        return onset, hop, sr, max_abs
    onset_norm = (onset - onset.min()) / (onset.max() - onset.min())
    return onset_norm, hop, sr, max_abs


def find_confident_peak(onset_norm, hop, sr):
    """Returns (contact_s, reason_if_none). Deliberately conservative - zero
    peaks clearing the thresholds, or multiple peaks too close in strength
    to separate confidently, both return None rather than guess."""
    if len(onset_norm) == 0:
        return None, "empty onset series"

    min_distance = max(1, round(PEAK_MIN_DISTANCE_S / (hop / sr)))
    peaks, props = find_peaks(
        onset_norm, height=PEAK_HEIGHT, prominence=PEAK_PROMINENCE, distance=min_distance,
    )
    if len(peaks) == 0:
        top = onset_norm.max() if len(onset_norm) else 0.0
        return None, f"no onset peak cleared confidence threshold (top height={top:.2f} < {PEAK_HEIGHT})"

    heights = props["peak_heights"]
    order = np.argsort(heights)[::-1]
    top_i = peaks[order[0]]
    top_h = heights[order[0]]
    if len(peaks) > 1:
        second_h = heights[order[1]]
        if top_h - second_h < AMBIGUITY_MARGIN:
            return None, (f"ambiguous - {len(peaks)} candidate peaks within margin "
                          f"(top={top_h:.2f}, runner-up={second_h:.2f})")

    contact_s = top_i * hop / sr
    return contact_s, None


def trim_video(video_path, start_s, duration_s, out_path):
    result = subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{start_s:.3f}", "-i", str(video_path),
         "-t", f"{duration_s:.3f}", "-an", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "18", "-pix_fmt", "yuv420p", "-avoid_negative_ts", "make_zero",
         str(out_path)],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not out_path.exists():
        return False
    try:
        trimmed_duration = video_duration_s(out_path)
    except (ValueError, subprocess.SubprocessError):
        return False
    return trimmed_duration > 0.5  # sanity floor, not a tight tolerance


def run(video_path, out_dir):
    video_path = pathlib.Path(video_path)
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        duration_s = video_duration_s(video_path)
    except (ValueError, subprocess.SubprocessError) as exc:
        result = _fallback(f"could not read video duration ({exc})", video_path)
        (out_dir / "stage0.json").write_text(json.dumps(result, indent=2))
        return result

    print(f"[locate_swing] {video_path.name}: duration={duration_s:.1f}s "
          f"(threshold={MIN_DURATION_FOR_PREPASS_S}s)")
    if duration_s < MIN_DURATION_FOR_PREPASS_S:
        result = _skip(video_path)
        print(f"[locate_swing] {result['reason']}")
        (out_dir / "stage0.json").write_text(json.dumps(result, indent=2))
        return result

    if not has_audio_stream(video_path):
        result = _fallback("no audio stream detected", video_path)
        (out_dir / "stage0.json").write_text(json.dumps(result, indent=2))
        return result

    wav_path = out_dir / "_stage0_audio.wav"
    if not extract_audio(video_path, wav_path):
        result = _fallback("audio extraction failed", video_path)
        (out_dir / "stage0.json").write_text(json.dumps(result, indent=2))
        return result

    onset_norm, hop, sr, max_abs = onset_strength_series(wav_path)
    if max_abs < SILENCE_FLOOR:
        result = _fallback(f"audio amplitude below usable-signal floor (max|x|={max_abs:.3f} < {SILENCE_FLOOR})",
                            video_path)
        (out_dir / "stage0.json").write_text(json.dumps(result, indent=2))
        return result

    contact_s, reason = find_confident_peak(onset_norm, hop, sr)
    if contact_s is None:
        result = _fallback(reason, video_path)
        (out_dir / "stage0.json").write_text(json.dumps(result, indent=2))
        return result

    trim_start = max(0.0, contact_s - PRE_MARGIN_S)
    trim_end = min(duration_s, contact_s + POST_MARGIN_S)
    trim_duration = trim_end - trim_start
    trimmed_path = out_dir / "_trimmed_input.mp4"

    print(f"[locate_swing] confident onset at t={contact_s:.2f}s -> "
          f"trimming [{trim_start:.2f}s, {trim_end:.2f}s] ({trim_duration:.1f}s)")

    if not trim_video(video_path, trim_start, trim_duration, trimmed_path):
        result = _fallback("trim ffmpeg failed or output verification failed", video_path)
        (out_dir / "stage0.json").write_text(json.dumps(result, indent=2))
        return result

    fps_guess = None
    try:
        import cv2
        cap = cv2.VideoCapture(str(video_path))
        fps_guess = cap.get(cv2.CAP_PROP_FPS) or None
        cap.release()
    except ImportError:
        pass
    if fps_guess:
        before_frames = round(duration_s * fps_guess)
        after_frames = round(trim_duration * fps_guess)
        reduction = 100 * (1 - after_frames / before_frames) if before_frames else 0
        print(f"[locate_swing] {before_frames} -> {after_frames} frames "
              f"({reduction:.1f}% reduction)")

    result = {
        "ran": True,
        "trimmed": True,
        "reason": f"confident onset at {contact_s:.2f}s",
        "video_path_for_pipeline": str(trimmed_path),
        "contact_estimate_s": contact_s,
        "trim_start_s": trim_start,
        "trim_end_s": trim_end,
        "trimmed_path": str(trimmed_path),
    }
    print(f"[locate_swing] wrote {trimmed_path}")
    (out_dir / "stage0.json").write_text(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python locate_swing.py <video_path> <out_dir>")
        sys.exit(1)
    run(sys.argv[1], sys.argv[2])
