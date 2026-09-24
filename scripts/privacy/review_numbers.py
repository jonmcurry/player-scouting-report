"""LOCAL-ONLY review sheet (shows the source): for every outline left visible as
the jersey number, SOURCE | OUTPUT zooms, so a human confirms each one really
is the number and nothing else.

  .venv_pose3d/Scripts/python.exe scripts/privacy/review_numbers.py --source VIDEO --output TREATED.mp4 \
      --components C.json --labels labels.json --out numbers.jpg
"""
import argparse, json
import cv2
import numpy as np

ap = argparse.ArgumentParser()
for k in ("--source", "--output", "--components", "--labels", "--out"):
    ap.add_argument(k, required=True)
a = ap.parse_args()
comps = {int(k): v for k, v in json.load(open(a.components))["frames"].items()}
lab = json.load(open(a.labels))
ex = {int(k): v for k, v in lab["exempt"].items()}
cs, co = cv2.VideoCapture(a.source), cv2.VideoCapture(a.output)
tiles, i = [], 0
while True:
    o1, s_ = cs.read(); o2, o_ = co.read()
    if not (o1 and o2):
        break
    if i in ex:
        W = 1280; H = int(round(s_.shape[0] * W / s_.shape[1] / 2) * 2)
        s_ = cv2.resize(s_, (W, H), interpolation=cv2.INTER_AREA); o_ = cv2.resize(o_, (W, H), interpolation=cv2.INTER_AREA)
        for k in ex[i]:
            h = np.array(comps[i]["hulls"][k]); cx, cy = h.mean(axis=0).astype(int)
            R = int(max(24, 0.9 * max(np.ptp(h[:, 0]), np.ptp(h[:, 1]))))
            X1, Y1, X2, Y2 = max(0, cx - R), max(0, cy - R), min(W, cx + R), min(H, cy + R)
            ov = s_.copy(); cv2.polylines(ov, [h.reshape(-1, 1, 2).astype(np.int32)], True, (0, 255, 255), 1)
            p = [cv2.resize(im[Y1:Y2, X1:X2], (220, 220), interpolation=cv2.INTER_CUBIC) for im in (ov, o_)]
            t = np.hstack([p[0], np.full((220, 3, 3), 255, np.uint8), p[1]])
            why = lab["decisions"][str(i)][str(k)]["why"]
            cv2.putText(t, f"f{i} {why[:30]}", (3, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)
            tiles.append(cv2.copyMakeBorder(t, 2, 2, 2, 2, cv2.BORDER_CONSTANT))
    i += 1
if tiles:
    cols = 3
    while len(tiles) % cols:
        tiles.append(np.zeros_like(tiles[0]))
    cv2.imwrite(a.out, np.vstack([np.hstack(tiles[k:k + cols]) for k in range(0, len(tiles), cols)]))
print(json.dumps({"number_outlines_reviewed": sum(len(v) for v in ex.values()), "sheet": a.out if tiles else None}))
