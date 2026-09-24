"""Decide which precise-mode lettering outlines are the batter's jersey NUMBER
(kept visible) - everything else stays obscured. Privacy wins every tie: an
outline is exempted only when ALL of these hold, else it stays masked.

  1. It is on the torso, not the helmet (the helmet decal carries the surname),
     not in the glove/bat area, and roughly square (aspect <= MAX_ASPECT) - a
     word outline or a lone stroke is never exempted.
  2. It sits below the name area: axial position (shoulder-mid 0 -> hip-mid 1)
     >= MIN_AXIAL. The back name bar and the chest team name are higher.
  3. OCR on the outline, cropped from the FULL-RESOLUTION source and turned
     upright with the torso, reads only digits that belong to the known jersey
     number (--number; e.g. 10 accepts "10", "1", "0"; O->0 and I/|->1 allowed),
     with confidence >= MIN_CONF (detector+recognizer) or >= MIN_CONF_REC
     (recognizer on the whole crop, tried only when the detector finds no
     text) at EVERY scale tried, and no fragment of any protected word anywhere.
     A misread such as "3" for a letter fragment is therefore rejected.
  -- or --
  4. It is the same outline as a number outline within +-LINK_FRAMES (tracked
     with the torso: IoU >= MIN_IOU, area ratio within bounds), satisfies 1-2,
     and OCR there read no letter that occurs in any protected word (and no
     protected fragment). Such a letter breaks the track.

Every exempted outline is then shown on a review sheet (review_numbers.py) for
visual confirmation; OCR is never taken as proof.

Runs in the OCR venv. The protected words are passed on the command line only.

  .venv_ocr/Scripts/python.exe scripts/privacy/classify_numbers.py --video VIDEO \\
      --components C.json --words WORD1 WORD2 --out labels.json
"""
import argparse, hashlib, json, re, sys, pathlib
import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from ocr_check import matches  # noqa: E402

MIN_AXIAL = 0.28
MIN_CONF = 0.5
MIN_CONF_REC = 0.8
SCALES = (96, 160)            # crop heights tried; EVERY scale must read only digits of the number
MAX_ASPECT = 1.8              # a two-digit number is roughly square; a word or a single stroke is not
LINK_FRAMES = 2
MIN_IOU = 0.5
AREA_RATIO = (0.6, 1.6)
WORK_W = 1280


def digits_only(text, number):
    t = re.sub(r"[\s.,'`\-_]", "", text.upper())
    t = t.replace("O", "0").replace("I", "1").replace("|", "1")
    return t if re.fullmatch(r"[0-9]{1,2}", t) and t in number else None


def clean(text):
    """Upper-cased letters/digits of an OCR read, with the digit look-alikes O->0, I/|->1."""
    return re.sub(r"[^A-Z0-9]", "", text.upper().replace("|", "1")).replace("O", "0").replace("I", "1")


def digit_like(text, number):
    t = re.sub(r"[\s.,'`\-_]", "", text.upper())
    t = t.replace("O", "0").replace("I", "1").replace("|", "1")
    return bool(t) and all(ch in number for ch in t) and not re.search(r"[A-Z]", t)


def poly_mask(h, shape, dx=0.0, dy=0.0):
    m = np.zeros(shape, np.uint8)
    cv2.fillConvexPoly(m, (np.array(h, np.float64) + [dx, dy]).astype(np.int32), 1)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--components", required=True)
    ap.add_argument("--words", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--number", required=True, help="the jersey number that may stay visible, e.g. 10")
    a = ap.parse_args()
    comps = json.load(open(a.components))
    vsha = hashlib.sha256(open(a.video, "rb").read()).hexdigest()
    if comps["source_video_sha256"] != vsha:
        sys.exit("FAIL: components cache is for a different video")
    frames = {int(k): v for k, v in comps["frames"].items()}
    protected_letters = set("".join(w.upper() for w in a.words)) - {"O", "I"}
    ocr = RapidOCR()
    cap = cv2.VideoCapture(a.video)
    decisions, i = {}, 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        s = WORK_W / f.shape[1]
        rec = frames.get(i) or {}
        for k, (h, meta) in enumerate(zip(rec.get("hulls", []), rec.get("hull_meta", []))):
            d = {"helmet": meta["helmet"], "axial": meta["axial"], "texts": [], "label": "mask", "why": ""}
            if meta["helmet"]:
                d["why"] = "helmet"
            elif meta.get("glove_or_bat_area", True):
                d["why"] = "glove/bat area (never exempt)"
            elif meta["axial"] is None or meta["axial"] < MIN_AXIAL:
                d["why"] = "name area (axial)"
            elif meta.get("aspect", 99) > MAX_ASPECT:
                d["why"] = f"word-shaped outline (aspect {meta.get('aspect')})"
            else:
                pts = np.array(h) / s
                x1, y1 = pts.min(axis=0); x2, y2 = pts.max(axis=0)
                pw, ph = 0.25 * (x2 - x1) + 4, 0.25 * (y2 - y1) + 4
                X1, Y1 = int(max(0, x1 - pw)), int(max(0, y1 - ph)); X2, Y2 = int(min(f.shape[1], x2 + pw)), int(min(f.shape[0], y2 + ph))
                crop0 = f[Y1:Y2, X1:X2]
                reads = []   # one (texts, rec_only) per scale
                for target_h in SCALES if crop0.size else ():
                    kk = max(1.0, target_h / max(1, crop0.shape[0]))
                    crop = cv2.resize(crop0, None, fx=kk, fy=kk, interpolation=cv2.INTER_CUBIC)
                    ang = rec.get("axis_deg") or 0.0
                    if abs(ang) > 5:   # turn the crop so the torso is upright
                        ch, cw = crop.shape[:2]
                        M = cv2.getRotationMatrix2D((cw / 2, ch / 2), -ang, 1.0)
                        c_, s_ = abs(M[0, 0]), abs(M[0, 1]); nw, nh = int(ch * s_ + cw * c_), int(ch * c_ + cw * s_)
                        M[0, 2] += nw / 2 - cw / 2; M[1, 2] += nh / 2 - ch / 2
                        crop = cv2.warpAffine(crop, M, (nw, nh), borderMode=cv2.BORDER_REPLICATE)
                    res, _ = ocr(crop)
                    texts = [(t, round(float(c), 3)) for _, t, c in (res or [])]
                    rec_only = False
                    if not texts:
                        r2, _ = ocr(crop, use_det=False, use_cls=False, use_rec=True)
                        texts = [(t, round(float(c), 3)) for t, c in (r2 or []) if t.strip()]
                        rec_only = bool(texts)
                    reads.append((texts, rec_only))
                d["texts"] = [t for texts, _ in reads for t in texts]
                # EVERY scale must read only digits of the number (measured: a team-name
                # outline read as "0" at one scale and as other text at the other was exempted)
                ok_reads = [(texts, ro) for texts, ro in reads
                            if texts and all(digits_only(t, a.number) and c >= (MIN_CONF_REC if ro else MIN_CONF) for t, c in texts)]
                if len(ok_reads) != len(reads):
                    ok_reads = []
                if any(matches(t, w) for t, _ in d["texts"] for w in a.words):
                    d["why"] = "protected word fragment read (at any scale)"
                elif not d["texts"]:
                    d["label"], d["why"] = "unread", "OCR read nothing"
                elif ok_reads:
                    texts, ro = ok_reads[0]
                    d["label"], d["why"] = "number", ("rec-only " if ro else "") + "digits: " + ",".join(digits_only(t, a.number) for t, _ in texts)
                else:
                    d["why"] = "OCR read other text or low confidence"
                # may a TRACKED number continue through this outline? only if nothing but
                # digit-like characters of the number (or nothing at all) was read here
                d["linkable"] = d["label"] != "mask" or (not d["why"].startswith("protected") and not any(set(clean(t)) & protected_letters for t, _ in d["texts"]))
            decisions.setdefault(i, {})[k] = d
        i += 1
    # Track confirmed numbers through neighbouring frames. A link needs the same outline
    # (IoU / area after following the torso) within +-LINK_FRAMES, on the torso below the
    # name area, and a "linkable" OCR result there (nothing read, or only digit-like
    # characters of the number). Any other letter or a protected fragment breaks the chain.
    shape = (WORK_W, WORK_W)   # covers any 1280-wide frame
    frontier = [(fi, k) for fi, ds in decisions.items() for k, d in ds.items() if d["label"] == "number"]
    while frontier:
        fi, k = frontier.pop()
        src = frames[fi]
        for fj in range(fi - LINK_FRAMES, fi + LINK_FRAMES + 1):
            if fj == fi or fj not in decisions or not src.get("anchor") or not frames[fj].get("anchor"):
                continue
            dx, dy = frames[fj]["anchor"][0] - src["anchor"][0], frames[fj]["anchor"][1] - src["anchor"][1]
            m_src = poly_mask(src["hulls"][k], shape, dx, dy); a_src = int(poly_mask(src["hulls"][k], shape).sum())
            for kk, d in decisions[fj].items():
                if (d["label"] == "number" or d["helmet"] or d["axial"] is None or d["axial"] < MIN_AXIAL or not d.get("linkable")
                        or d["why"].startswith(("glove/bat", "word-shaped", "protected"))):
                    continue
                m = poly_mask(frames[fj]["hulls"][kk], shape)
                inter, uni = int((m & m_src).sum()), int((m | m_src).sum())
                if uni and inter / uni >= MIN_IOU and AREA_RATIO[0] <= int(m.sum()) / max(1, a_src) <= AREA_RATIO[1]:
                    d["label"], d["why"] = "number", f"tracked from frame {fi} (IoU {inter / uni:.2f})"
                    frontier.append((fj, kk))
    exempt = {str(fi): sorted(k for k, d in ds.items() if d["label"] == "number") for fi, ds in decisions.items()}
    exempt = {k: v for k, v in exempt.items() if v}
    labels = [d["label"] for ds in decisions.values() for d in ds.values()]
    out = {"source_video_sha256": vsha, "exempt": exempt,
           "rules": {"number": a.number, "min_axial": MIN_AXIAL, "min_conf": MIN_CONF, "min_conf_rec_only": MIN_CONF_REC, "scales": SCALES, "max_aspect": MAX_ASPECT,
                     "link_frames": LINK_FRAMES, "min_iou": MIN_IOU, "area_ratio": AREA_RATIO,
                     "digits": "OCR text of digits of the given number only (O->0, I/|->1); anything else or a protected-word fragment keeps it masked",
                     "tracking": "from OCR-confirmed outlines through linkable outlines only; a read letter that occurs in any protected word, or a protected fragment, breaks the chain"},
           "stats": {"outlines": len(labels), "number_outlines": labels.count("number"), "frames_with_number_visible": len(exempt),
                     "unread_left_masked": labels.count("unread"), "frames": i},
           # OCR text is never stored (it can contain a protected word); "why" names digits only
           "decisions": {str(fi): {str(k): {**{x: d[x] for x in ("label", "why", "axial", "helmet")}, "ocr_items": len(d["texts"])}
                                   for k, d in ds.items()} for fi, ds in decisions.items()}}
    json.dump(out, open(a.out, "w"), indent=1)
    print(json.dumps(out["stats"]))


if __name__ == "__main__":
    main()
