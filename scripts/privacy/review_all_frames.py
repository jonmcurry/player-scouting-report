"""EVERY frame of a treated clip, cropped head-to-hips around the subject and
enlarged, in numbered sheets - the full frame-by-frame visual inspection of
the public output (shows only the treated video, never the source).

  .venv_pose3d/Scripts/python.exe scripts/privacy/review_all_frames.py --output TREATED.mp4 \\
      --pose2d .../pose_2d.json --out-prefix demo-export/privacy/.../allframes [--per-sheet 42]
"""
import argparse, json
import cv2
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", required=True)
    ap.add_argument("--pose2d", required=True)
    ap.add_argument("--out-prefix", required=True)
    ap.add_argument("--per-sheet", type=int, default=42)
    ap.add_argument("--cols", type=int, default=6)
    a = ap.parse_args()
    pose = json.load(open(a.pose2d)); meta = pose["meta"]
    cap = cv2.VideoCapture(a.output)
    tiles, i, names = [], 0, []
    TW, TH = 250, 300

    def flush():
        if not tiles:
            return
        while len(tiles) % a.cols:
            tiles.append(np.zeros_like(tiles[0]))
        p = f"{a.out_prefix}-{len(names) + 1:02d}.jpg"
        cv2.imwrite(p, np.vstack([np.hstack(tiles[k:k + a.cols]) for k in range(0, len(tiles), a.cols)]), [cv2.IMWRITE_JPEG_QUALITY, 88])
        names.append(p); tiles.clear()

    while True:
        ok, f = cap.read()
        if not ok:
            break
        s = f.shape[1] / meta["width"]
        kp = pose["frames"][i].get("keypoints") or [] if i < len(pose["frames"]) else []
        g = [(x * s, y * s) for x, y, c in kp if c >= 0.3]
        if len(g) >= 5:
            x1, x2 = min(p[0] for p in g), max(p[0] for p in g); y1, y2 = min(p[1] for p in g), max(p[1] for p in g)
            h = y2 - y1; cx = (x1 + x2) / 2
            X1, X2 = int(max(0, cx - 0.42 * h)), int(min(f.shape[1], cx + 0.42 * h))
            Y1, Y2 = int(max(0, y1 - 0.12 * h)), int(min(f.shape[0], y1 + 0.66 * h))
            crop = f[Y1:Y2, X1:X2]
        else:
            crop = f
        t = cv2.resize(crop, (TW, TH), interpolation=cv2.INTER_AREA)
        cv2.putText(t, f"{i}", (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
        tiles.append(cv2.copyMakeBorder(t, 2, 2, 2, 2, cv2.BORDER_CONSTANT))
        i += 1
        if len(tiles) == a.per_sheet:
            flush()
    flush()
    print(json.dumps({"frames": i, "sheets": names}))


if __name__ == "__main__":
    main()
