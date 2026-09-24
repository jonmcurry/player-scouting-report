"""How much trunk movement can still be read from a treated clip: re-detect pose on
the treated OUTPUT and compare shoulder/hip keypoints with the pipeline's own
pose_2d (the analysis). Higher confidence and lower error = more of the trunk's
position and rotation is visible to a viewer. Run once per treatment to compare.

  .venv_pose3d/Scripts/python.exe scripts/privacy/compare_torso_pose.py --output TREATED.mp4 \\
      --pose2d .../pose_2d.json --out report.json
"""
import argparse, json, math, pathlib
import cv2
import numpy as np

MODEL = pathlib.Path(__file__).resolve().parents[1] / "pose3d" / "models" / "yolo11m-pose.pt"
TORSO = (5, 6, 11, 12)          # shoulders, hips


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", required=True)
    ap.add_argument("--pose2d", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    from ultralytics import YOLO
    model = YOLO(str(MODEL))
    pose = json.load(open(a.pose2d)); meta = pose["meta"]
    cap = cv2.VideoCapture(a.output)
    rows, i = [], 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        s = f.shape[1] / meta["width"]
        ref = [[x * s, y * s, c] for x, y, c in (pose["frames"][i].get("keypoints") or [])] if i < len(pose["frames"]) else []
        rec = {"frame": i}
        if ref and all(ref[j][2] >= 0.3 for j in TORSO):
            ys = [k[1] for k in ref if k[2] >= 0.3]; bh = max(ys) - min(ys)
            res = model(f, conf=0.1, verbose=False, imgsz=1280)[0]
            best = None
            if res.keypoints is not None and len(res.keypoints):
                for kp in res.keypoints.data.tolist():
                    d = [math.hypot(kp[j][0] - ref[j][0], kp[j][1] - ref[j][1]) for j in range(17) if ref[j][2] >= 0.3]
                    m = float(np.median(d)) if d else math.inf
                    if best is None or m < best[0]:
                        best = (m, kp)
            if best is not None and best[0] < 0.25 * bh:
                kp = best[1]
                rec["torso_conf"] = round(float(np.mean([kp[j][2] for j in TORSO])), 3)
                rec["torso_err_frac"] = round(float(np.median([math.hypot(kp[j][0] - ref[j][0], kp[j][1] - ref[j][1]) for j in TORSO])) / bh, 4)
                ang = lambda p, q: math.degrees(math.atan2(q[1] - p[1], q[0] - p[0]))
                rec["shoulder_line_err_deg"] = round(abs(((ang(kp[5], kp[6]) - ang(ref[5], ref[6])) + 180) % 360 - 180), 2)
            else:
                rec["torso_found"] = False
        rows.append(rec)
        i += 1
    got = [r for r in rows if "torso_conf" in r]
    rep = {"output": a.output, "frames": i, "frames_with_reference_torso": len([r for r in rows if len(r) > 1]),
           "torso_found_frames": len(got),
           "torso_conf_mean": round(float(np.mean([r["torso_conf"] for r in got])), 3) if got else None,
           "torso_err_frac_median": round(float(np.median([r["torso_err_frac"] for r in got])), 4) if got else None,
           "shoulder_line_err_deg_median": round(float(np.median([r["shoulder_line_err_deg"] for r in got])), 2) if got else None,
           "per_frame": rows}
    json.dump(rep, open(a.out, "w"), indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k != "per_frame"}))


if __name__ == "__main__":
    main()
