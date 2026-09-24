"""Text-level check that given words (e.g. a surname or team name) do not
appear anywhere in a video - run on the ORIGINAL too, to prove the OCR can
actually read them there (otherwise "not found in the output" means nothing).

Every frame is read twice: the whole frame at 1280 px wide, and an upscaled
crop around the subject (pipeline pose_2d bbox + 40%), since jersey lettering
is small, plus an upscaled head/upper-back crop (helmet decals are smaller still). A detection matches a target word if its letters contain any 4+
letter run of the word, or equal the word within one edit.

The words are passed on the command line and never stored in the repo.
Runs in the separate OCR venv: .venv_ocr/Scripts/python.exe (rapidocr_onnxruntime).

  .venv_ocr/Scripts/python.exe scripts/privacy/ocr_check.py --video V --pose2d P \
      --words WORD1 WORD2 --out report.json
"""
import argparse, json, re
import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR


def edit1(a, b):
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) <= 1
    if len(a) > len(b):
        a, b = b, a
    return any(a == b[:k] + b[k + 1:] for k in range(len(b)))


def matches(text, word):
    t = re.sub(r"[^A-Z]", "", text.upper())
    w = word.upper()
    if len(t) < 3:
        return False
    if any(w[k:k + 4] in t for k in range(len(w) - 3)):
        return True
    return any(edit1(t[k:k + len(w)], w) for k in range(max(1, len(t) - len(w) + 1)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--pose2d", required=True)
    ap.add_argument("--words", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", default="")
    a = ap.parse_args()
    pose = json.load(open(a.pose2d)); meta = pose["meta"]
    ocr = RapidOCR()
    cap = cv2.VideoCapture(a.video)
    hits, texts, i = [], {}, 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        s = f.shape[1] / meta["width"]
        views = [("full", cv2.resize(f, (1280, int(1280 * f.shape[0] / f.shape[1]))))]
        kps = (pose["frames"][i].get("keypoints") or []) if i < len(pose["frames"]) else []
        g = [(x * s, y * s) for x, y, c in kps if c >= 0.3]
        if len(g) >= 5:
            x1, x2 = min(p[0] for p in g), max(p[0] for p in g); y1, y2 = min(p[1] for p in g), max(p[1] for p in g)
            px, py = 0.4 * (x2 - x1), 0.4 * (y2 - y1)
            X1, Y1, X2, Y2 = int(max(0, x1 - px)), int(max(0, y1 - py)), int(min(f.shape[1], x2 + px)), int(min(f.shape[0], y2 + py))
            crop = f[Y1:Y2, X1:X2]
            if crop.size:
                k = max(1.0, 900.0 / max(1, crop.shape[0]))
                views.append(("subject_crop", cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)))
            hk = [(kps[j][0] * s, kps[j][1] * s) for j in range(5) if kps[j][2] >= 0.3]
            if hk:
                bh = y2 - y1
                hx, hy = np.mean([p[0] for p in hk]), np.mean([p[1] for p in hk])
                X1, X2 = int(max(0, hx - 0.25 * bh)), int(min(f.shape[1], hx + 0.25 * bh))
                Y1, Y2 = int(max(0, hy - 0.25 * bh)), int(min(f.shape[0], hy + 0.30 * bh))
                crop = f[Y1:Y2, X1:X2]
                if crop.size:
                    k = max(1.0, 600.0 / max(1, crop.shape[0]))
                    views.append(("head_crop", cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)))
        for view, img in views:
            res, _ = ocr(img)
            for box, text, conf in (res or []):
                texts.setdefault(text, 0); texts[text] += 1
                for w in a.words:
                    if matches(text, w):
                        hits.append({"frame": i, "view": view, "word": "<target %d>" % a.words.index(w), "text": text, "conf": round(float(conf), 3)})
        i += 1
    per_word = {"<target %d>" % k: sorted({h["frame"] for h in hits if h["word"] == "<target %d>" % k}) for k in range(len(a.words))}
    out = {"label": a.label, "frames": i, "hits": hits, "frames_with_hits_per_word": per_word,
           "verdict": "TEXT_FOUND" if hits else "NOT_FOUND", "all_text_seen": sorted(texts.items(), key=lambda kv: -kv[1])[:60]}
    json.dump(out, open(a.out, "w"), indent=1)
    print(json.dumps({"label": a.label, "frames": i, "verdict": out["verdict"], "frames_with_hits_per_word": {k: len(v) for k, v in per_word.items()}}))


if __name__ == "__main__":
    main()
