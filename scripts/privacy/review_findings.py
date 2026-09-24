"""LOCAL REVIEW ONLY: source-vs-output zooms of every region a privacy check
flagged, so a human can judge each one. The left half of every tile shows
the UNOBSCURED source (bystanders visible) - never publish this output.

Inputs: the clip's validation JSON (validator findings) and frames JSON
(anonymizer head-overlap exposures). Up to --max tiles, spread across the
flagged frames.
"""
import argparse, json
import cv2
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    for k in ("source", "output", "frames-json", "pose2d", "out"):
        ap.add_argument(f"--{k}", required=True)
    ap.add_argument("--validation-json")
    ap.add_argument("--max", type=int, default=16)
    a = ap.parse_args()
    targets = {}
    if a.validation_json:
        for f in json.load(open(a.validation_json))["findings"]:
            targets.setdefault(f["frame"], []).extend(("validator", tuple(i["box"])) for i in f["issues"])
    log = json.load(open(a.frames_json))
    pose = json.load(open(a.pose2d)); pscale = None
    exposed = [r for r in log if r["exposures"]]
    for r in exposed:
        targets.setdefault(r["frame"], []).append(("overlap", None))
    frames = sorted(targets)
    if len(frames) > a.max:
        frames = [frames[int(k)] for k in np.linspace(0, len(frames) - 1, a.max)]
    src, out = cv2.VideoCapture(a.source), cv2.VideoCapture(a.output)
    tiles, i = [], 0
    want = set(frames)
    while want:
        ok1, fs = src.read(); ok2, fo = out.read()
        if not (ok1 and ok2):
            break
        if i in want:
            want.discard(i)
            fs = cv2.resize(fs, (fo.shape[1], fo.shape[0]), interpolation=cv2.INTER_AREA)
            boxes = [b for kind, b in targets[i] if b]
            if boxes:
                cx = int(np.mean([(b[0] + b[2]) / 2 for b in boxes])); cy = int(np.mean([(b[1] + b[3]) / 2 for b in boxes]))
            else:   # overlap flag: centre on the subject (the pipeline's own keypoints)
                sc = fo.shape[1] / pose["meta"]["width"]
                pts = [(x * sc, y * sc) for x, y, c in (pose["frames"][i].get("keypoints") or []) if c >= 0.3]
                cx, cy = (int(np.mean([p[0] for p in pts])), int(np.mean([p[1] for p in pts]))) if pts else (fo.shape[1] // 2, fo.shape[0] // 2)
            X1 = min(max(0, cx - 160), fo.shape[1] - 320); Y1 = min(max(0, cy - 120), fo.shape[0] - 240)
            pa, pb = fs[Y1:Y1 + 240, X1:X1 + 320].copy(), fo[Y1:Y1 + 240, X1:X1 + 320].copy()
            for b in boxes:
                for im in (pa, pb):
                    cv2.rectangle(im, (b[0] - X1, b[1] - Y1), (b[2] - X1, b[3] - Y1), (0, 0, 255), 1)
            pair = np.hstack([cv2.resize(pa, (480, 360)), cv2.resize(pb, (480, 360))])
            kinds = ",".join(sorted({k for k, _ in targets[i]}))
            cv2.putText(pair, f"#{i} [{kinds}]  SOURCE (local only) | OUTPUT", (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
            tiles.append(pair)
        i += 1
    if tiles:
        cv2.imwrite(a.out, np.vstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(json.dumps({"tiles": len(tiles), "frames": frames}))


if __name__ == "__main__":
    main()
