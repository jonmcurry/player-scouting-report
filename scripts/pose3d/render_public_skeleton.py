"""
Privacy-safe abstract skeleton renderer, for public display in a player's
report. Unlike overlay.py (Stage 4 QA - real video pixels, coach-only, never
published), this draws ONLY joint dots/lines/bat path on a blank background -
no real video frame, no real pixels of the player at all - annotated with the
real computed metrics (knee angle, hip-shoulder separation) at the joint they
came from, so what reaches the public site is the DATA, not her image. Same
principle as this project's earlier privacy-safe silhouette work, just without
even the flattened-body-mask step, since a skeleton alone carries the coaching
signal this needs (see the swing-model page's own standing decision that real
motion data tied to a named child needs a real reason and a real gate before
it's used).

Gated, not assumed correct: refuses to render unless metrics.json's
contact.confidence == "high" - the same trust signal metrics.py itself
validated (see its module docstring: contact = argmax of bat-speed, knee-
extension, AND body-rotation agreeing, with two real false positives already
caught and fixed during that script's own development). Writes
render_manifest.json recording that gate result plus an "approvedBy": null
placeholder a coach fills in by hand after watching this clip's overlay.mp4
(the real-video QA render) - report generation must refuse to embed this
output unless BOTH the gate passed AND approvedBy is set (see
generate_team_reports.ps1's publish-gate check). Nothing here claims the
pose-estimation pipeline is infallible; the manifest is what makes an
unreviewed render structurally unable to reach the public site.

Usage: python render_public_skeleton.py <clip_dir> <out_dir>
  (expects pose_2d.json, pose_3d.json, bat_path.json, metrics.json in clip_dir,
   all already produced by scripts/pose3d/run_pipeline.py)
"""
import sys
import json
import pathlib

import cv2
import numpy as np

# Matches metrics.py's own window convention for "around contact," not a new number.
ALIGNMENT_TOLERANCE_S = 0.5

SKELETON_EDGES = [
    (5, 6), (11, 12), (5, 11), (6, 12),
    (5, 7), (7, 9), (6, 8), (8, 10),
    (11, 13), (13, 15), (12, 14), (14, 16),
]
L_KNEE, R_KNEE = 13, 14
L_HIP, R_HIP = 11, 12

BG = (247, 247, 249)              # near-white canvas - no real video pixels, ever
SKELETON_COLOR = (214, 120, 42)   # BGR, close to the site's series-1 blue
BAT_COLOR = (87, 141, 176)
TEXT_COLOR = (30, 30, 30)
CONTACT_COLOR = (0, 0, 200)


def write_manifest(out_dir, manifest):
    (out_dir / "render_manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"[render_public_skeleton] {manifest['reason']}")


def main():
    if len(sys.argv) != 3:
        print("Usage: python render_public_skeleton.py <clip_dir> <out_dir>")
        sys.exit(1)
    clip_dir = pathlib.Path(sys.argv[1])
    out_dir = pathlib.Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)

    metrics = json.loads((clip_dir / "metrics.json").read_text())
    manifest = {"clip": clip_dir.name, "validated": False, "approvedBy": None}

    if "error" in metrics:
        manifest["reason"] = f"skipped: no contact detected ({metrics['error']})"
        write_manifest(out_dir, manifest)
        return

    confidence = metrics["contact"]["confidence"]
    if confidence != "high":
        manifest["reason"] = (f"skipped: contact confidence is '{confidence}', not 'high' - "
                               "refusing to render for public display (same gate "
                               "pose3d_to_checklist.py uses to decide which clips count)")
        write_manifest(out_dir, manifest)
        return

    pose_2d = json.loads((clip_dir / "pose_2d.json").read_text())
    pose_3d = json.loads((clip_dir / "pose_3d.json").read_text())
    bat_path = json.loads((clip_dir / "bat_path.json").read_text())
    fps = pose_2d["meta"]["fps"]
    p2 = pose_2d["frames"]
    p3 = pose_3d["frames"]
    bat = bat_path["frames"]

    contact_frame = metrics["contact"]["frame"]
    half_window = int(round(ALIGNMENT_TOLERANCE_S * 2 * fps))
    i0 = max(contact_frame - half_window, 0)
    i1 = min(contact_frame + half_window, len(p2) - 1)

    # Crop box from every tracked joint AND the bat tip/knob across the whole
    # render window - not just the joints. The bat reaches well past the wrist
    # at extension; the old silhouette pipeline shipped a clipped-bat bug once
    # from sizing the crop off joint positions alone (see pose_silhouette.py's
    # bat_tip_full docstring) - same lesson, applied here from the start.
    xs, ys = [], []
    for i in range(i0, i1 + 1):
        kp = p2[i]["keypoints"]
        if kp is not None:
            for x, y, c in kp:
                if c > 0.15:
                    xs.append(x)
                    ys.append(y)
        bf = bat[i] if i < len(bat) else None
        if bf is not None:
            for pt in (bf.get("tip"), bf.get("knob")):
                if pt is not None:
                    xs.append(pt[0])
                    ys.append(pt[1])

    if not xs:
        manifest["reason"] = "skipped: no tracked keypoints in the contact window - cannot render"
        write_manifest(out_dir, manifest)
        return

    pad = 0.20
    bw, bh = max(xs) - min(xs), max(ys) - min(ys)
    x0, x1 = min(xs) - bw * pad, max(xs) + bw * pad
    y0, y1 = min(ys) - bh * pad, max(ys) + bh * pad
    crop_w, crop_h = x1 - x0, y1 - y0

    out_w = 480
    scale = out_w / crop_w
    out_h = max(1, int(crop_h * scale))

    def proj(pt):
        return (int((pt[0] - x0) * scale), int((pt[1] - y0) * scale))

    n_written = 0
    for i in range(i0, i1 + 1):
        img = np.full((out_h, out_w, 3), BG, dtype=np.uint8)
        kp = p2[i]["keypoints"]
        angles = p3[i]["angles"] if i < len(p3) else None

        if kp is not None:
            for a, b in SKELETON_EDGES:
                pa, pb = kp[a], kp[b]
                if pa[2] > 0.15 and pb[2] > 0.15:
                    cv2.line(img, proj(pa), proj(pb), SKELETON_COLOR, 3, cv2.LINE_AA)
            for x, y, c in kp:
                if c > 0.15:
                    cv2.circle(img, proj((x, y)), 5, SKELETON_COLOR, -1, cv2.LINE_AA)

            if angles is not None:
                # Fixed-position readout (bottom-left), not floating text pinned
                # to the joint itself: a first version drew the knee-angle labels
                # right at each knee, and a real frame near contact often has
                # both knees close together in the 2D projection - the two
                # labels landed on top of each other and were illegible. Caught
                # by actually looking at a rendered frame, not by trusting the
                # code ran. A fixed HUD-style panel stays readable regardless of
                # how the limbs happen to project this frame.
                lines = []
                l_knee = angles.get("l_knee_angle_deg")
                r_knee = angles.get("r_knee_angle_deg")
                if l_knee is not None or r_knee is not None:
                    l_txt = f"{l_knee:.0f}°" if l_knee is not None else "—"
                    r_txt = f"{r_knee:.0f}°" if r_knee is not None else "—"
                    lines.append(f"Knee: L {l_txt} / R {r_txt}")
                sep = angles.get("hip_shoulder_separation_deg")
                if sep is not None:
                    lines.append(f"Hip-shoulder sep: {sep:.0f}°")
                for j, line in enumerate(lines):
                    y = out_h - 12 - (len(lines) - 1 - j) * 18
                    cv2.putText(img, line, (10, y), cv2.FONT_HERSHEY_SIMPLEX,
                                0.5, TEXT_COLOR, 1, cv2.LINE_AA)

        bf = bat[i] if i < len(bat) else None
        if bf is not None and bf.get("tip") is not None and bf.get("knob") is not None:
            cv2.line(img, proj(bf["knob"]), proj(bf["tip"]), BAT_COLOR, 5, cv2.LINE_AA)

        if i == contact_frame:
            cv2.putText(img, "CONTACT", (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, CONTACT_COLOR, 2)

        cv2.imwrite(str(out_dir / f"skel_{n_written:03d}.webp"), img, [cv2.IMWRITE_WEBP_QUALITY, 80])
        n_written += 1

    manifest["validated"] = True
    manifest["n_frames"] = n_written
    manifest["contact_local_index"] = contact_frame - i0
    manifest["reason"] = ("rendered: contact confidence high, but still needs a coach's sign-off "
                           f"(after watching {clip_dir / 'overlay.mp4'}) before this goes live - "
                           "set approvedBy in this manifest to publish")
    write_manifest(out_dir, manifest)


if __name__ == "__main__":
    main()
