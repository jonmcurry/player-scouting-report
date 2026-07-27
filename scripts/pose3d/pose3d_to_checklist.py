"""
Turn one or more clip_dir/metrics.json outputs (from run_pipeline.py) into the
same CHECKLIST-shaped JSON snippet scripts/pose_to_checklist.py produces from
the old MediaPipe CSV pipeline - same two checkpoints, same output keys, so it
drops into a report exactly the same way. Per the project spec: "do not
invent a new report format."

Difference from the old flow: no hand-authored windows.json sidecar. Contact
timing is auto-detected per clip in metrics.py (bat-speed peak, cross-checked
against knee-extension timing) instead of a human eyeballing load/contact
frame ranges - metrics.json's own contact.confidence ("high"/"low"/"unknown")
takes over the role windows.json's clean_contact flag + the alignment check
used to play. A clip is only used here if confidence == "high".

Extension scoring reuses the exact thresholds already calibrated in
pose_to_checklist.py (EXTENSION_THRESHOLDS) - unchanged, since that
calibration was against real film and doesn't depend on which pipeline
produced the knee angle.

Hip-shoulder separation, lead-elbow-angle, stride, and attack-angle numbers
are all reported as evidence text (same "numbers yes, score no" stance the
old script took for separation) since there's still no validated
angle-to-score mapping for any of them - one player's film isn't enough to
calibrate a rubric.

Usage: python pose3d_to_checklist.py <frames/player_slug glob or clip_dir...> <out.json>
Example: python pose3d_to_checklist.py "frames/emily_c/*" out.json
"""
import sys
import json
import glob
import pathlib

EXTENSION_THRESHOLDS = [
    (155, 3),
    (140, 2),
    (0, 1),
]


def extension_score(angle):
    for threshold, score in EXTENSION_THRESHOLDS:
        if angle >= threshold:
            return score
    return 1


def main():
    if len(sys.argv) != 3:
        print("Usage: python pose3d_to_checklist.py <clip_dir_glob> <out.json>")
        sys.exit(1)

    clip_glob, out_path = sys.argv[1], pathlib.Path(sys.argv[2])
    clip_dirs = [pathlib.Path(p) for p in glob.glob(clip_glob) if pathlib.Path(p).is_dir()]

    usable = []
    skipped = []
    extension_maxes = []
    separation_reads = []
    lead_elbow_reads = []
    stride_reads = []

    for clip_dir in clip_dirs:
        mpath = clip_dir / "metrics.json"
        if not mpath.exists():
            skipped.append((clip_dir.name, "no metrics.json"))
            continue
        m = json.loads(mpath.read_text())
        if "error" in m:
            skipped.append((clip_dir.name, m["error"]))
            continue
        if m["contact"]["confidence"] != "high":
            skipped.append((clip_dir.name,
                             f"contact confidence={m['contact']['confidence']} "
                             f"(bat-speed peak and knee-extension peak didn't agree)"))
            continue

        usable.append(clip_dir.name)
        knee = m.get("front_knee_angle_at_contact_deg")
        if knee is not None:
            extension_maxes.append((clip_dir.name, knee))
        sep = m.get("hip_shoulder_separation_at_contact_deg")
        if sep is not None:
            separation_reads.append((clip_dir.name, sep))
        elbow = m.get("lead_elbow_angle_at_contact_deg")
        if elbow is not None:
            lead_elbow_reads.append((clip_dir.name, elbow))
        stride = m.get("stride")
        if stride is not None:
            stride_reads.append((clip_dir.name, stride))

    result = {}

    if extension_maxes:
        weakest_clip, weakest_max = min(extension_maxes, key=lambda x: x[1])
        score = extension_score(weakest_max)
        clips_txt = ", ".join(f"{c} ({v:.0f}°)" for c, v in extension_maxes)
        notes = (
            f"Pose3D pipeline (YOLO11-pose + VideoPose3D): front knee reaches "
            f"{weakest_max:.0f}-{max(v for _, v in extension_maxes):.0f}° at contact "
            f"across {len(usable)} high-confidence swing(s): {clips_txt}. Provisional "
            f"thresholds (>=155°=3, 140-154°=2, <140°=1), same calibration as "
            f"the prior MediaPipe pipeline - revisit once more players' data exists."
        )
        result["Extension"] = {
            "score": score, "aiDraft": score, "reviewedBy": None,
            "notes": notes, "source_clips": usable,
        }
    else:
        result["Extension"] = None

    if separation_reads:
        sep_txt = "; ".join(f"~{v:.0f}° ({c})" for c, v in separation_reads)
        elbow_txt = ("; ".join(f"~{v:.0f}° ({c})" for c, v in lead_elbow_reads)
                     if lead_elbow_reads else "n/a")
        stride_txt = ("; ".join(
            f"{s['length_hip_widths']:.2f} hip-widths @ {s['direction_deg']:.0f}° ({c})"
            for c, s in stride_reads) if stride_reads else "n/a")
        notes = (
            f"Hip-shoulder separation at auto-detected contact (3D, YOLO11-pose+VideoPose3D): "
            f"{sep_txt}. Lead-elbow angle at contact: {elbow_txt}. Stride "
            f"(front-ankle displacement, first-tracked-frame to contact): {stride_txt}. "
            f"Contact instant is auto-detected (bat-speed peak, cross-checked against "
            f"knee-extension timing) - only clips where both signals agreed within 0.5s are "
            f"included here. No 1-3 score is suggested for any of these numbers - there's no "
            f"validated angle-to-score mapping yet, only a validated way to tell which "
            f"readings are trustworthy."
        )
        result["Hip-shoulder separation"] = {
            "score": None, "aiDraft": None, "reviewedBy": None,
            "notes": notes, "source_clips": [c for c, _ in separation_reads],
        }
    else:
        result["Hip-shoulder separation"] = None

    out_path.write_text(json.dumps(result, indent=2))

    print(f"Clips used (high contact confidence): {usable}")
    print(f"Clips skipped: {skipped}")
    for label, entry in result.items():
        print(f"{label}: no usable data" if entry is None else f"{label}: score={entry['score']}")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
