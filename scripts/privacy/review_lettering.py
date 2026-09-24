"""LOCAL-ONLY review sheet (shows the unobscured source): SOURCE|OUTPUT pairs of
the batter's head-to-hips region, sampled evenly across the clip plus every
frame where OCR read a protected word in the source (ocr_check.py output).

  .venv_pose3d/Scripts/python.exe scripts/privacy/review_lettering.py --source VIDEO \
      --output demo-export/privacy/<clip>.mp4 --pose2d .../pose_2d.json \
      --ocr-source demo-export/privacy/ocr/<clip>.source.json --out demo-export/privacy/review/<clip>.lettering.jpg
"""
import argparse, json
import cv2, numpy as np

ap = argparse.ArgumentParser()
for k in ("--source", "--output", "--pose2d", "--ocr-source", "--out"):
    ap.add_argument(k, required=True)
ap.add_argument("--samples", type=int, default=24)
A = ap.parse_args()
src, out, pose2d, ocr_src, dst, n = A.source, A.output, A.pose2d, A.ocr_source, A.out, A.samples
pose = json.load(open(pose2d)); meta = pose["meta"]
hits = sorted({x for v in json.load(open(ocr_src))["frames_with_hits_per_word"].values() for x in v})
N = len(pose["frames"])
frames = sorted(set(np.linspace(0, N - 1, n).astype(int).tolist()) | set(hits[::max(1, len(hits) // 12)]))
ca, cb = cv2.VideoCapture(src), cv2.VideoCapture(out)
tiles, i = [], 0
want = set(frames)
while True:
    oa, a = ca.read(); ob, b = cb.read()
    if not (oa and ob):
        break
    if i in want:
        kp = pose["frames"][i].get("keypoints") or []
        s = a.shape[1] / meta["width"]
        g = [(x * s, y * s) for x, y, c in kp if c >= 0.3]
        if len(g) >= 5:
            b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_NEAREST)
            x1, x2 = min(p[0] for p in g), max(p[0] for p in g); y1, y2 = min(p[1] for p in g), max(p[1] for p in g)
            h = y2 - y1
            X1, X2 = int(max(0, (x1 + x2) / 2 - 0.4 * h)), int(min(a.shape[1], (x1 + x2) / 2 + 0.4 * h))
            Y1, Y2 = int(max(0, y1 - 0.12 * h)), int(min(a.shape[0], y1 + 0.62 * h))
            pr = [cv2.resize(im[Y1:Y2, X1:X2], (260, 300), interpolation=cv2.INTER_AREA) for im in (a, b)]
            t = np.hstack([pr[0], np.full((300, 3, 3), 255, np.uint8), pr[1]])
            tag = f"f{i}" + (" OCR" if i in hits else "")
            cv2.putText(t, tag, (4, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            tiles.append(cv2.copyMakeBorder(t, 3, 3, 3, 3, cv2.BORDER_CONSTANT))
    i += 1
cols = 4
while len(tiles) % cols:
    tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite(dst, np.vstack([np.hstack(tiles[k:k + cols]) for k in range(0, len(tiles), cols)]), [cv2.IMWRITE_JPEG_QUALITY, 82])
print(dst, len(tiles))
