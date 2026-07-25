"""
Consolidate the per-frame pose CSVs (scripts/pose_out/*.csv) into a short summary
per clip: front-knee angle range (load -> extension) and hip-shoulder separation
(3D, transverse-plane version - see pose_analyze.py for why 2D was unusable from
a behind-the-plate camera) around the swing windows already identified by manual
frame review earlier in this analysis.

This is a one-off analysis script, not part of the report-generation pipeline -
it exists to turn raw per-frame CSVs into numbers worth a human (or Claude)
looking at before deciding what, if anything, goes into the report.
"""
import csv
import pathlib

OUT_DIR = pathlib.Path(__file__).parent / "pose_out"


def load(fn):
    return list(csv.DictReader(open(OUT_DIR / fn)))


def window_stats(rows, t0, t1, col):
    vals = [float(r[col]) for r in rows if t0 <= float(r["time_s"]) <= t1 and r[col] != ""]
    if not vals:
        return None
    return {"n": len(vals), "min": min(vals), "max": max(vals), "avg": sum(vals) / len(vals)}


def report(fn, windows):
    rows = load(fn)
    print(f"=== {fn} ===")
    for label, t0, t1 in windows:
        knee = window_stats(rows, t0, t1, "front_knee_angle_deg")
        sep = window_stats(rows, t0, t1, "separation_3d_deg")
        knee_s = f"knee {knee['min']:.0f}-{knee['max']:.0f} (avg {knee['avg']:.0f})" if knee else "knee: no data"
        sep_s = f"sep(3d) {sep['min']:.0f}-{sep['max']:.0f} (avg {sep['avg']:.0f})" if sep else "sep: no data"
        print(f"  {label:<28} {knee_s:<32} {sep_s}")
    print()


if __name__ == "__main__":
    report("Emily_C_AB1 (1)_pose.csv", [
        ("pre-swing (0-37s)", 0, 37),
        ("swing/contact (37-45s)", 37, 45),
        ("sprint (45-52s)", 45, 52),
    ])
    report("Emily_C_AB1 (2)_pose.csv", [
        ("pre-swing (0-13s)", 0, 13),
        ("swing (13-22s)", 13, 22),
        ("after (22-32s)", 22, 32),
    ])
    report("Emily_C_AB1 (3)_pose.csv", [
        ("segment 0-15s (no swing)", 0, 15),
        ("segment 15-30s (no swing)", 15, 30),
        ("segment 30-45s (no swing)", 30, 45),
    ])
    report("Emily_C_AB1 (4)_pose.csv", [
        ("pre-swing (0-30s)", 0, 30),
        ("load/stride (30.5-33.6s)", 30.5, 33.6),
        ("contact/extension (33.6-35s)", 33.6, 35),
        ("follow-through (35-42s)", 35, 42),
    ])
    report("Emily_C_AB2_pose.csv", [
        ("early swing (~48-56s)", 48, 56),
        ("mid at-bat, mostly takes (60-210s)", 60, 210),
        ("final swing/contact (~215-222s)", 215, 222),
        ("sprint to 1B (~222-232s)", 222, 232),
    ])
