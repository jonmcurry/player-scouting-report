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

Speed stance: a raw upload becoming a SHORT analysis window is the entire
point of this stage - Stages 1-4 are the genuinely expensive ones (two full
per-frame YOLO passes + a 3D lift), and their cost scales directly with
however many frames Stage 0 hands them. A real 1GB/27,647-frame/921s clip
took ~15-22 minutes end to end specifically BECAUSE ambiguous audio (multiple
similarly-loud onsets - a noisy recording, not just one foul ball near the
real swing) used to fall all the way back to analyzing the entire clip rather
than commit to a guess. Fixed: any peak clearing the absolute height
threshold gets used - ambiguous just downgrades `confidence` to "low"
(surfaced in stage0.json), it no longer blocks the trim. This trades a small
chance of centering the window on the wrong transient for guaranteed speed;
metrics.py's OWN independent, multi-signal contact detection still runs for
real within whatever window this picks and is the actual place a bad guess
here would get caught (a low bat-speed-normalized-product confidence, same
as today). Only a clip with literally zero audio signal at all (no audio
stream, silent/muted track, or extraction failure) still falls back to the
full clip - see _fallback() callers below.

Usage: python locate_swing.py <video_path> <out_dir>
  (writes out_dir/stage0.json and, if a trim is made, out_dir/_trimmed_input.mp4)
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
                           # differ by at least this much, or the top peak
                           # is still used but confidence downgrades to "low"
                           # (see find_confident_peak) - never blocks the trim.

MAX_AMBIGUOUS_CANDIDATES = 4  # cap on how many candidate windows get a real
                               # motion-energy check when ambiguous - each one
                               # costs an ffmpeg trim + a cheap OpenCV decode,
                               # so this bounds that work regardless of how
                               # many peaks the audio produced (a real clip
                               # produced 10).
MOTION_DOWNSCALE_WIDTH = 160  # pixels - motion_energy_score only needs a
                               # coarse "did something big just move" signal,
                               # not real detail; small enough that decoding
                               # a ~12-20s window is fast regardless of the
                               # source resolution/frame count.


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
    """Returns (contact_s, confidence, note, ambiguous_candidates_s).
    contact_s is None ONLY when zero peaks clear the absolute height
    threshold at all - an ambiguous multi-candidate case still returns a
    best-guess instant (the single strongest peak, in case the caller wants
    a fast path without motion-scoring), PLUS up to MAX_AMBIGUOUS_CANDIDATES
    candidate times (by descending height) for run() to disambiguate among
    with a cheap real signal (motion energy) instead of blindly trusting
    "loudest = real contact" - a real 1GB clip proved that assumption wrong:
    the loudest of 10 candidates trimmed to a window with no bat-holding
    evidence at all, and contact detection failed outright. A short analysis
    window is still the entire point of Stage 0 (Stages 1-4 are the genuinely
    expensive ones), but "short and wrong" produces nothing usable - not an
    acceptable tradeoff, so this earns its keep by checking a handful of
    candidates for real before commiting to one."""
    if len(onset_norm) == 0:
        return None, None, "empty onset series", []

    min_distance = max(1, round(PEAK_MIN_DISTANCE_S / (hop / sr)))
    peaks, props = find_peaks(
        onset_norm, height=PEAK_HEIGHT, prominence=PEAK_PROMINENCE, distance=min_distance,
    )
    if len(peaks) == 0:
        top = onset_norm.max() if len(onset_norm) else 0.0
        return None, None, f"no onset peak cleared confidence threshold (top height={top:.2f} < {PEAK_HEIGHT})", []

    heights = props["peak_heights"]
    order = np.argsort(heights)[::-1]
    top_i = peaks[order[0]]
    top_h = heights[order[0]]
    confidence = "high"
    note = None
    ambiguous_candidates_s = []  # only populated when ambiguous - see below
    if len(peaks) > 1:
        second_h = heights[order[1]]
        if top_h - second_h < AMBIGUITY_MARGIN:
            confidence = "low"
            # Once ambiguous, take the top MAX_AMBIGUOUS_CANDIDATES peaks by
            # height outright - NOT just the ones within AMBIGUITY_MARGIN of
            # the loudest. On a real clip, restricting to that tight margin
            # only admitted 2 of 10 real peaks (the other 8, including
            # several at 0.77-0.83 height, were excluded outright) - and
            # BOTH admitted candidates turned out to have no real swing in
            # them. A peak's exact loudness relative to the single loudest
            # one isn't a reliable signal for "definitely not real contact";
            # every peak that cleared the base PEAK_HEIGHT/PROMINENCE
            # thresholds already earned a real shot at being tried.
            top_idx = order[:MAX_AMBIGUOUS_CANDIDATES]
            ambiguous_candidates_s = [peaks[i] * hop / sr for i in top_idx]
            note = (f"ambiguous - {len(peaks)} candidate peaks within margin "
                     f"(top={top_h:.2f}, runner-up={second_h:.2f})")

    contact_s = top_i * hop / sr
    return contact_s, confidence, note, ambiguous_candidates_s


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


def motion_energy_score(video_path):
    """Cheap, non-ML disambiguator between a handful of already-short
    (~12-20s) candidate windows: the single biggest frame-to-frame pixel
    change, on downscaled grayscale frames. A real bat swing is a fast,
    large-amplitude movement; a false audio trigger (dugout noise, a foul
    tip's echo, someone hitting the backstop) usually isn't paired with one
    in the SAME short window. This only ever runs on an already-trimmed
    handful-of-seconds clip, never the original upload - decoding a few
    hundred downscaled frames is fast regardless of source resolution/frame
    count, nothing like the cost of the real per-frame YOLO passes this
    exists specifically to avoid running on the wrong window."""
    import cv2
    cap = cv2.VideoCapture(str(video_path))
    prev_gray = None
    max_diff = 0.0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]
            scale = MOTION_DOWNSCALE_WIDTH / w
            small = cv2.resize(frame, (MOTION_DOWNSCALE_WIDTH, max(1, round(h * scale))))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)
            if prev_gray is not None:
                max_diff = max(max_diff, float(np.mean(np.abs(gray - prev_gray))))
            prev_gray = gray
    finally:
        cap.release()
    return max_diff


def rank_ambiguous_windows(video_path, candidates_s, duration_s, out_dir):
    """Trims a short candidate window per audio candidate (bounded by
    MAX_AMBIGUOUS_CANDIDATES) and scores each with motion_energy_score - a
    cheap proxy for "does something swing-like happen here," used only to
    ORDER candidates for run_pipeline.py to try with the real detector
    (metrics.py's own contact/phase detection), not to pick a final winner
    unilaterally. Motion energy is a proxy, not ground truth: a real clip
    proved that even the highest-motion candidate can still have no real bat
    activity. Returns a list of dicts sorted best-first (by motion score),
    each with the ALREADY-TRIMMED video path - nothing is deleted here, so
    every candidate stays available for a caller to actually try."""
    scored = []
    for i, cand_s in enumerate(candidates_s):
        start = max(0.0, cand_s - PRE_MARGIN_S)
        end = min(duration_s, cand_s + POST_MARGIN_S)
        cand_path = out_dir / f"_candidate_{i}.mp4"
        if not trim_video(video_path, start, end - start, cand_path):
            print(f"[locate_swing] candidate {i} (t={cand_s:.2f}s): trim failed, skipping")
            continue
        score = motion_energy_score(cand_path)
        print(f"[locate_swing] candidate {i} (t={cand_s:.2f}s, window [{start:.2f}s, {end:.2f}s]): "
              f"motion score={score:.2f}")
        scored.append({
            "index": i, "score": score, "contact_estimate_s": cand_s,
            "trim_start_s": start, "trim_end_s": end, "video_path_for_pipeline": str(cand_path),
        })
    scored.sort(key=lambda d: d["score"], reverse=True)
    return scored


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

    contact_s, confidence, note, ambiguous_candidates_s = find_confident_peak(onset_norm, hop, sr)
    if contact_s is None:
        # Truly zero signal to work with - no peak anywhere cleared even the
        # absolute height threshold. Still the only remaining full-clip-
        # fallback path left in this file.
        result = _fallback(note, video_path)
        (out_dir / "stage0.json").write_text(json.dumps(result, indent=2))
        return result

    candidate_windows = None  # only set when ambiguous - see below

    if len(ambiguous_candidates_s) > 1:
        # Loudest onset is NOT reliably the real swing - confirmed on a real
        # clip where the loudest of 10 candidates had no bat-holding evidence
        # at all and contact detection failed outright, AND the runner-up (by
        # motion energy too) also failed. Motion energy is ALSO just a proxy,
        # not ground truth - this function no longer picks a final winner
        # itself. It ranks every candidate and hands the full ranked list
        # back; run_pipeline.py tries them in order against the REAL detector
        # (metrics.py's own contact/phase logic) and keeps the first one that
        # actually finds something, rather than committing to any single
        # cheap proxy's guess.
        print(f"[locate_swing] {note} - ranking {len(ambiguous_candidates_s)} candidates by motion energy "
              f"for run_pipeline.py to try in order (neither loudest audio nor most motion is reliably "
              f"the real swing on its own)")
        candidate_windows = rank_ambiguous_windows(video_path, ambiguous_candidates_s, duration_s, out_dir)
        if not candidate_windows:
            result = _fallback("all ambiguous-candidate trims failed", video_path)
            (out_dir / "stage0.json").write_text(json.dumps(result, indent=2))
            return result
        best = candidate_windows[0]
        trimmed_path = pathlib.Path(best["video_path_for_pipeline"])
        trim_start, trim_end, contact_s = best["trim_start_s"], best["trim_end_s"], best["contact_estimate_s"]
        reason = f"{note} - {len(candidate_windows)} candidates ranked by motion energy, trying in order"
    else:
        trimmed_path = out_dir / "_trimmed_input.mp4"
        trim_start = max(0.0, contact_s - PRE_MARGIN_S)
        trim_end = min(duration_s, contact_s + POST_MARGIN_S)
        reason = note or f"confident onset at {contact_s:.2f}s"
        print(f"[locate_swing] {reason} -> trimming [{trim_start:.2f}s, {trim_end:.2f}s] ({trim_end - trim_start:.1f}s)")
        if not trim_video(video_path, trim_start, trim_end - trim_start, trimmed_path):
            result = _fallback("trim ffmpeg failed or output verification failed", video_path)
            (out_dir / "stage0.json").write_text(json.dumps(result, indent=2))
            return result

    trim_duration = trim_end - trim_start
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
        "reason": reason,
        "confidence": confidence,  # "high" (clean single peak) or "low" (ambiguous - see candidate_windows)
        # Full ranked list (best motion score first), only set when ambiguous - run_pipeline.py tries
        # these in order against the real detector instead of trusting this file's own best guess.
        "candidate_windows": candidate_windows,
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
