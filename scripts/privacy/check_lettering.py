"""Independent residual-lettering check for a privacy-treated clip.

For every frame: find lettering-like strokes in the SOURCE with a stricter
detector than anonymize_clip.py uses (lower contrast threshold, looser chroma,
no glove/bat exclusion, a silhouette grown to catch letters wrapping to the
edge), then count those pixels that survive in the output: unchanged AND
still standing out as a stroke there. A frame
with a surviving stroke cluster is listed as uncertain for human review - this
check can flag, it can never prove absence (neither can OCR). Surviving
clusters on gloves, piping and the silhouette edge are recorded separately
(visible by design in the precise treatment); any other cluster makes the
frame uncertain.

Also measures how much of the subject's torso (shoulder-hip quad) and helmet
disc stay unobscured, to compare treatments.

  .venv_pose3d/Scripts/python.exe scripts/privacy/check_lettering.py --source VIDEO \\
      --output TREATED.mp4 --pose2d .../pose_2d.json --out report.json [--crops crops.jpg]
"""
import argparse, json, sys
import cv2
import numpy as np

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import anonymize_clip as ac  # noqa: E402

CHECK_TH, CHECK_CR, CHECK_CB = 20, 20, 28   # stricter than the anonymizer (30 / 16 / 24)
UNCHANGED = 14                              # mean |out - src| below this = pixel was not obscured ...
OUT_STROKE = 15                             # ... AND still a stroke in the output (top-hat above this):
                                            # blurring a flat patch barely changes it, so "unchanged"
                                            # alone flagged every obscured frame
SIL_GROW = 0.03                             # x body height
MIN_CLUSTER = 12                            # px (1280 wide): smaller surviving specks are not legible text


def torso_quad(kps):
    idx = (5, 6, 12, 11)
    if all(kps[j][2] >= ac.KP_CONF for j in idx):
        return np.array([[kps[j][0], kps[j][1]] for j in idx], np.int32)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--pose2d", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--crops")
    ap.add_argument("--components", help="precise mode: components cache (with --number-labels)")
    ap.add_argument("--number-labels", help="precise mode: outlines deliberately left visible as the jersey number")
    a = ap.parse_args()
    nums = {}
    if a.number_labels:
        comps = {int(k): v for k, v in json.load(open(a.components))["frames"].items()}
        for k, v in json.load(open(a.number_labels))["exempt"].items():
            nums[int(k)] = [np.array(comps[int(k)]["hulls"][j], np.int32) for j in v]
    pose = json.load(open(a.pose2d)); meta = pose["meta"]
    from ultralytics import YOLO
    seg = YOLO(str(ac.SEG_MODEL))
    cs, co = cv2.VideoCapture(a.source), cv2.VideoCapture(a.output)
    W = ac.WORK_W; s = W / meta["width"]; H = int(round(meta["height"] * s / 2) * 2)
    frames, crops, i = [], [], 0
    while True:
        o1, src = cs.read(); o2, out = co.read()
        if not (o1 and o2):
            break
        src = cv2.resize(src, (W, H), interpolation=cv2.INTER_AREA)
        out = cv2.resize(out, (W, H), interpolation=cv2.INTER_AREA)
        pf = pose["frames"][i] if i < len(pose["frames"]) else {}
        kps = [[x * s, y * s, c] for x, y, c in (pf.get("keypoints") or [])]
        rec = {"frame": i, "checked": False}
        if kps:
            _, _, reliable, body_h = ac.subject_masks(kps, None, (H, W))
            unchanged = (np.abs(out.astype(np.int16) - src.astype(np.int16)).mean(axis=2) < UNCHANGED).astype(np.uint8) * 255
            q = torso_quad(kps)
            if q is not None:
                tm = np.zeros((H, W), np.uint8); cv2.fillConvexPoly(tm, q, 255)
                rec["torso_visible"] = round(float((unchanged[tm > 0] > 0).mean()), 4)
            if reliable >= ac.MIN_RELIABLE_KPS:
                hz, _ = ac.helmet_mask(kps, body_h, (H, W))
                hz_full = np.zeros((H, W), np.uint8)
                head = [kps[j] for j in range(5) if kps[j][2] >= ac.KP_CONF]
                if head:
                    ears = [kps[j] for j in (3, 4) if kps[j][2] >= ac.KP_CONF] or head
                    c = (int(np.mean([k[0] for k in ears])), int(np.mean([k[1] for k in ears]) - ac.HELMET_LIFT * body_h))
                    cv2.circle(hz_full, c, max(6, int(ac.HELMET_R * body_h)), 255, -1)
                    rec["helmet_visible"] = round(float((unchanged[hz_full > 0] > 0).mean()), 4)
                sil = ac.subject_silhouette(seg(src, conf=0.25, classes=[0], verbose=False, imgsz=W, retina_masks=True)[0], kps, (H, W))
                if sil is None:
                    rec.update(checked=False, reason="no_silhouette")
                else:
                    k = max(3, int(2 * SIL_GROW * body_h) | 1)
                    sil = cv2.dilate(sil, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
                    jz, _ = ac.jersey_mask(kps, None, body_h, (H, W))
                    # helmet zone = the whole shell except the face window below the brim (no decal there)
                    zone = cv2.bitwise_and(cv2.bitwise_or(jz, hz), sil)
                    cand = ac.letter_candidates(src, zone, body_h, th=CHECK_TH, cr=CHECK_CR, cb=CHECK_CB)
                    tk = max(3, int(ac.LETTER_TOPHAT * body_h) | 1)
                    oy = cv2.cvtColor(out, cv2.COLOR_BGR2YCrCb)[..., 0]
                    ostroke = (cv2.morphologyEx(oy, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (tk, tk))) > OUT_STROKE).astype(np.uint8) * 255
                    resid = cv2.bitwise_and(cv2.bitwise_and(cand, unchanged), ostroke)
                    kk = max(3, int(ac.LETTER_CLOSE * body_h) | 1)
                    rc = cv2.morphologyEx(resid, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kk, kk)))
                    n, lab, st, cen = cv2.connectedComponentsWithStats(rc)
                    # Classify each surviving cluster. Gloves, jersey piping and silhouette-edge
                    # highlights are visible BY DESIGN in the precise treatment; they are recorded
                    # (and shown to the reviewer) but only "other" clusters make a frame uncertain.
                    hands = np.zeros((H, W), np.uint8)
                    for w_ in (9, 10):
                        if kps[w_][2] >= ac.KP_CONF:
                            cv2.circle(hands, (int(kps[w_][0]), int(kps[w_][1])), max(4, int(1.3 * ac.HAND_R * body_h)), 255, -1)
                    ek = max(3, int(0.04 * body_h) | 1)
                    core = cv2.erode(sil, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ek * 2 + 1, ek * 2 + 1)))
                    cats = {"number": [], "hand": [], "line": [], "edge": [], "other": []}
                    numm = np.zeros((H, W), np.uint8)
                    for hl in nums.get(i, []):
                        cv2.fillConvexPoly(numm, hl.reshape(-1, 2), 255)
                    other_boxes = []
                    for j in range(1, n):
                        area = int(st[j, cv2.CC_STAT_AREA])
                        if area < MIN_CLUSTER:
                            continue
                        m = lab == j
                        pts = np.column_stack(np.nonzero(m)[::-1]).astype(np.int32)
                        (_, _), (rw, rh), _ = cv2.minAreaRect(pts)
                        if (numm[m] > 0).mean() > 0.5:
                            cats["number"].append(area)      # left visible on purpose; confirmed on the review_numbers sheet
                        elif (hands[m] > 0).mean() > 0.5:
                            cats["hand"].append(area)
                        elif min(rw, rh) < ac.LINE_THIN * body_h and max(rw, rh) > ac.LINE_LONG * body_h:
                            cats["line"].append(area)
                        elif (core[m] > 0).mean() < 0.5:
                            cats["edge"].append(area)
                        else:
                            cats["other"].append(area)
                            other_boxes.append([int(st[j, cv2.CC_STAT_LEFT]), int(st[j, cv2.CC_STAT_TOP]), int(st[j, cv2.CC_STAT_WIDTH]), int(st[j, cv2.CC_STAT_HEIGHT])])
                    rec.update(checked=True, candidate_px=int((cand > 0).sum()), residual_px=int((resid > 0).sum()),
                               clusters={k: sorted(v, reverse=True) for k, v in cats.items()}, other_boxes=other_boxes, uncertain=bool(cats["other"]))
                    big = cats["other"]
                    comps = sorted(big, reverse=True)
                    if big and a.crops and len(crops) < 60:
                        g = [(x, y) for x, y, c in kps if c >= ac.KP_CONF]
                        x1, x2 = int(max(0, min(p[0] for p in g) - 0.15 * body_h)), int(min(W, max(p[0] for p in g) + 0.15 * body_h))
                        y1, y2 = int(max(0, min(p[1] for p in g) - 0.1 * body_h)), int(min(H, min(p[1] for p in g) + 0.6 * body_h))
                        ov = out.copy(); ov[resid > 0] = (0, 0, 255)
                        tile = [cv2.resize(im[y1:y2, x1:x2], None, fx=240 / (y2 - y1), fy=240 / (y2 - y1)) for im in (src, out, ov)]
                        t = np.hstack(tile); cv2.putText(t, f"f{i} max={comps[0]}", (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
                        crops.append(t)
        frames.append(rec)
        i += 1
    checked = [f for f in frames if f["checked"]]
    unc = [f["frame"] for f in checked if f.get("uncertain")]
    tv = [f["torso_visible"] for f in frames if "torso_visible" in f]
    hv = [f["helmet_visible"] for f in frames if "helmet_visible" in f]
    report = {"output": a.output, "frames": i, "checked_frames": len(checked),
              "unchecked_frames": [f["frame"] for f in frames if not f["checked"]],
              "uncertain_frames": unc, "params": {"th": CHECK_TH, "cr": CHECK_CR, "cb": CHECK_CB, "unchanged": UNCHANGED, "out_stroke": OUT_STROKE, "min_cluster": MIN_CLUSTER},
              "torso_visible_mean": round(float(np.mean(tv)), 4) if tv else None,
              "helmet_visible_mean": round(float(np.mean(hv)), 4) if hv else None,
              "per_frame": frames}
    json.dump(report, open(a.out, "w"), indent=1)
    if crops and a.crops:
        w = max(c.shape[1] for c in crops)
        cv2.imwrite(a.crops, np.vstack([cv2.copyMakeBorder(c, 0, 3, 0, w - c.shape[1], cv2.BORDER_CONSTANT) for c in crops]))
    print(json.dumps({k: report[k] for k in ("frames", "checked_frames", "unchecked_frames", "uncertain_frames", "torso_visible_mean", "helmet_visible_mean")}))


if __name__ == "__main__":
    main()
