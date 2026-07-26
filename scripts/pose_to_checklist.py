"""
Turn already-generated pose CSVs (scripts/pose_out/*.csv, from pose_analyze.py) into a
CHECKLIST-shaped JSON snippet a coach can paste into a player's report, for the checkpoints
pose estimation actually informs today.

Only "Extension" gets an automated score suggestion - front-knee angle is validated as robust
across real game film (see project notes: ~130-150 deg in the load, ~155-180 deg through
contact/extension, on every real swing checked). "Hip-shoulder separation" gets computed
numbers in the evidence text but NO score suggestion - that metric is validated as real but
noisy (unreliable at the blurriest contact instant). A raw separation number on its own can't
be judged as clean or noisy by a coach just looking at it, so this script classifies each
reading automatically instead of punting that judgment to a human: a separation peak is only
trusted if it occurs at the same moment (within ALIGNMENT_TOLERANCE_S) as that same clip's
knee-extension peak - i.e. it's actually happening at contact, not during some other motion
(running, turning) that the window happens to also cover. Readings that don't align are
reported as excluded, with the reason, rather than left for a human to somehow eyeball. This
is still a heuristic (temporal coincidence isn't proof), which is why no 1-3 score is
suggested even for a trusted reading - there's no validated mapping yet from a separation
angle to a score, only a validated way to tell which numbers are worth looking at. Both
checkpoints are emitted with reviewedBy left null - a coach still has to sign off, same
contract as a Claude-vision draft.

Swing-phase windows (load/contact per clip) are NOT auto-detected - pass them in via a small
hand-authored JSON sidecar (see scripts/pose_out/emily_c_windows.json for an example). This
replaces pose_summarize.py's hardcoded-in-Python windows with reusable data; pose_summarize.py
is retired once this script's output is verified to reproduce its numbers.

Usage: python pose_to_checklist.py <windows.json> <out.json>
"""
import sys
import csv
import json
import pathlib

OUT_DIR = pathlib.Path(__file__).parent / "pose_out"

# Provisional, calibrated against one player's real film (see module docstring) - not
# validated science. Revisit once more players' data exists.
EXTENSION_THRESHOLDS = [
    (155, 3),
    (140, 2),
    (0, 1),
]

# How close (seconds) a separation peak must land to that clip's knee-extension peak to be
# trusted as "actually the swing." Provisional - windows here run 1-9s wide and were hand-picked
# around the swing, not the swing itself, so some slop is expected; revisit with more clips.
ALIGNMENT_TOLERANCE_S = 0.5


def load(fn):
    with open(OUT_DIR / fn, newline="") as f:
        return list(csv.DictReader(f))


def window_stats(rows, t0, t1, col):
    vals = [float(r[col]) for r in rows if t0 <= float(r["time_s"]) <= t1 and r[col] != ""]
    if not vals:
        return None
    return {"n": len(vals), "min": min(vals), "max": max(vals), "avg": sum(vals) / len(vals)}


def window_argmax(rows, t0, t1, col):
    """(time_s, value) of the row with the largest col value in [t0, t1], or None."""
    best = None
    for r in rows:
        t = float(r["time_s"])
        if t0 <= t <= t1 and r[col] != "":
            v = float(r[col])
            if best is None or v > best[1]:
                best = (t, v)
    return best


def extension_score(angle):
    for threshold, score in EXTENSION_THRESHOLDS:
        if angle >= threshold:
            return score
    return 1


def main():
    if len(sys.argv) != 3:
        print("Usage: python pose_to_checklist.py <windows.json> <out.json>")
        sys.exit(1)

    windows_path, out_path = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    session = json.loads(windows_path.read_text())

    load_mins = []          # knee-angle load-phase min per clip, evidence only
    extension_maxes = []    # knee-angle contact-phase max per clip - drives the Extension score
    separation_reads = []   # (clip, peak_separation_deg) per clean_contact clip with data
    usable_clips = []
    skipped_clips = []

    for clip in session["clips"]:
        csv_name = clip["csv"]
        if not clip.get("clean_contact") or not clip.get("contact"):
            skipped_clips.append(csv_name)
            continue
        rows = load(csv_name)
        c0, c1 = clip["contact"]
        knee = window_stats(rows, c0, c1, "front_knee_angle_deg")
        knee_peak = window_argmax(rows, c0, c1, "front_knee_angle_deg")
        sep_peak = window_argmax(rows, c0, c1, "separation_3d_deg")
        if knee is None:
            skipped_clips.append(csv_name)
            continue
        usable_clips.append(csv_name)
        extension_maxes.append(knee["max"])
        if clip.get("load"):
            l0, l1 = clip["load"]
            load_knee = window_stats(rows, l0, l1, "front_knee_angle_deg")
            if load_knee:
                load_mins.append(load_knee["min"])
        if sep_peak is not None and knee_peak is not None:
            gap = abs(sep_peak[0] - knee_peak[0])
            separation_reads.append({
                "clip": csv_name,
                "value": round(sep_peak[1], 1),
                "gap_s": round(gap, 2),
                "aligned": gap <= ALIGNMENT_TOLERANCE_S,
            })

    result = {}

    if extension_maxes:
        # Score off the WEAKEST clean-contact swing, not the best one - "does she do this
        # consistently" is the coaching-relevant claim, not "can she do it once."
        weakest_max = min(extension_maxes)
        score = extension_score(weakest_max)
        load_txt = f"~{min(load_mins):.0f}° in the load, " if load_mins else ""
        notes = (
            f"Pose estimation quantifies it: front knee bends to {load_txt}"
            f"straightening to ~{weakest_max:.0f}-{max(extension_maxes):.0f}° through "
            f"contact/extension across {len(usable_clips)} clean-contact swing(s) "
            f"({', '.join(usable_clips)}). Provisional thresholds "
            f"(>=155°=3, 140-154°=2, <140°=1), calibrated on one player's film - "
            f"revisit once more players' data exists."
        )
        result["Extension"] = {
            "score": score, "aiDraft": score, "reviewedBy": None,
            "notes": notes, "source_clips": usable_clips,
        }
    else:
        result["Extension"] = None

    if separation_reads:
        plausible = [r for r in separation_reads if r["aligned"]]
        excluded = [r for r in separation_reads if not r["aligned"]]

        notes_parts = []
        if plausible:
            plaus_txt = "; ".join(f"~{r['value']}° ({r['clip']})" for r in plausible)
            notes_parts.append(
                f"Hip-shoulder separation (3D), peak coincides with the knee-extension peak "
                f"(within {ALIGNMENT_TOLERANCE_S}s, i.e. actually happening at contact): "
                f"{plaus_txt}."
            )
        if excluded:
            exc_txt = "; ".join(
                f"~{r['value']}° ({r['clip']}, peak is {r['gap_s']}s from the knee-extension "
                f"instant)" for r in excluded
            )
            notes_parts.append(
                f"Excluded as likely NOT the swing (peak occurs well away from contact, so "
                f"more likely running/turning than the swing itself): {exc_txt}."
            )
        notes_parts.append(
            "Alignment is a heuristic (temporal coincidence with contact), not certainty - no "
            "1-3 score is auto-suggested for this checkpoint even for a trusted reading, since "
            "there's no validated mapping yet from a separation angle to a score."
        )
        result["Hip-shoulder separation"] = {
            "score": None, "aiDraft": None, "reviewedBy": None,
            "notes": " ".join(notes_parts),
            "source_clips": [r["clip"] for r in plausible],
        }
    else:
        result["Hip-shoulder separation"] = None

    out_path.write_text(json.dumps(result, indent=2))

    print(f"Clips used: {usable_clips}")
    print(f"Clips skipped (no contact window / no swing / no data): {skipped_clips}")
    for label, entry in result.items():
        if entry is None:
            print(f"{label}: no usable data")
        else:
            print(f"{label}: score={entry['score']}  {entry['notes']}")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
