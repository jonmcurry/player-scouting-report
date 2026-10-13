"""Privacy treatment for a curated demo clip: keep ONLY the analyzed batter.

Design (fail closed, see docs/research/demo-privacy-video.md):

  * Identity comes from the pipeline itself: pose_2d.json holds the batter
    track the pose3d pipeline measured (chosen by bat-holding evidence across
    the whole clip, not size/position). The anonymizer never re-decides who
    the subject is.
  * Everything is obscured by default (pixelate + blur). Only a keep region
    built from the subject's keypoints (+ margin) and tracked bat stays
    visible - so people a detector misses, spectators, reflections and
    background clothing are covered without depending on detection.
  * Inside that keep region, every OTHER person found by YOLO pose tracking
    (ByteTrack, low confidence) is masked too, except the subject's own tight
    body outline. Boxes are held for HOLD_FRAMES after a person disappears
    (occlusion / missed detection).
  * Frames where the subject's own keypoints are unreliable are obscured
    entirely.
  * No crop, no generative alteration. Output keeps every frame, in order,
    at the analysis frame rate (CFR), uniformly scaled - frame i of the output
    is frame i of the analysis, at time i/fps, the same clock swing_phases and
    pose frames use.

Writes: <out>/<name>.mp4, <out>/<name>.frames.json (per-frame audit),
<out>/<name>.summary.json, and review sheets (<name>.sheet.jpg public view,
<name>.debug.jpg with masks/tracks drawn).
"""
import argparse
import hashlib
import json
import math
import os
import pathlib
import subprocess
import sys

import cv2
import numpy as np

MODEL = pathlib.Path(__file__).resolve().parents[1] / "models" / "pr5-baseline-recovery" / "yolo11m-pose.pt"
MODEL2 = MODEL.with_name("yolov8m.pt")   # second detector architecture: mask anything EITHER model sees
WORK_W = 1280                 # working/output width (16:9 -> 1280x720)
DET_CONF = 0.10               # deliberately low: a false positive only masks more
DET_IMGSZ = 1920              # upscaled inference: small/half-hidden spectators were missed at 1280
KP_CONF = 0.30                # subject keypoint confidence considered reliable
MIN_RELIABLE_KPS = 8          # fewer reliable subject joints -> obscure whole frame
KEEP_MARGIN = 0.05            # keep-region margin, fraction of subject body height (small: background beside the
                              # subject is never needed, and a wide margin once exposed a spectator standing at the fence)
OTHER_PAD = 0.15              # other-person box padding
HOLD_FRAMES = 8               # keep masking a vanished track this long
BAT_HOLDER_MIN = 0.85         # the analyzed subject must be the one holding the tracked bat
# Identity continuity is GEOMETRIC. A torso-colour check was tried and
# rejected: the batter's jersey front (blue) and back (white) differ, so it
# fired on every turn, while missing nothing geometry doesn't catch.
ID_SCALE_JUMP = 1.35          # body height changing by >35% between tracked frames = track switched person
ID_CENTER_JUMP = 0.25         # centre moving >0.25 body heights per frame = track switched person
POST_SWING_S = 1.0            # frames later than last analysis phase + this are obscured (running/fielding,
                              # where both observed track switches happened; not swing evidence)
HEAD_EXPOSURE_FLAG = 0.02     # >2% of another person's head region left visible -> flag
TORSO_EXPOSURE_FLAG = 0.10
# Subject's own jersey lettering (surname name-bar on the back, team name on
# the front) is obscured with a band that follows the torso: see jersey_mask().
JERSEY_TOP = 0.10             # band starts this far (x body height) above the shoulder line (back name bar)
JERSEY_BOTTOM = 0.85          # ... and ends this fraction of the way from shoulders to hips (chest lettering;
                              # 0.62 left the lower letters exposed when leaning forward out of the box)
JERSEY_HALF_W = 1.40          # half-width = this x half the shoulder span ...
JERSEY_MIN_HALF_W = 0.18      # ... but never narrower than this x body height (side-on views; 0.10 exposed
                              # chest-letter edges on a side-on forward lean)
# Back-of-helmet decal (surname/number): see helmet_mask().
HELMET_R = 0.15               # helmet radius x body height
HELMET_LIFT = 0.03            # helmet centre sits this far (x body height) above the ears
HELMET_FACE_R = 0.09          # face window radius around the nose (x body height)
HELMET_BRIM_ABOVE_EYES = 0.015  # the window never extends above this (x body height) over the eyes
# --lettering-mode precise (prototype): instead of the broad torso band + helmet
# mask, obscure only the lettering itself, found per frame. See precise_lettering().
SEG_MODEL = MODEL.with_name("yolo11m-seg.pt")
LETTER_TOPHAT = 0.05          # candidate: a thin bright STROKE - white top-hat over this x body height ...
LETTER_TH = 30                # ... brighter than its surroundings by this much (flat sky, glare and wide
                              # side panels are not strokes; a first, brightness-only try merged them
                              # with the letters into blobs larger than the broad band)
LETTER_CR = 16                # ... and low chroma (|Cr-128|, |Cb-128| under these): white/grey lettering
LETTER_CB = 24
LETTER_CLOSE = 0.02           # strokes merged into words with a closing of this x body height
LETTER_MIN_PX = 6             # components smaller than this (px at 1280 wide) are noise
LETTER_MARGIN = 0.02          # each word's filled outline grown by this x body height
LETTER_TEMPORAL = 1           # also apply the masks of +-this many frames (shifted with the torso)
LINE_THIN = 0.02              # a component thinner than this x body height ...
LINE_LONG = 0.10              # ... and longer than this is jersey piping/trim, not text
HAND_R = 0.06                 # gloves (white panels) never seed a lettering outline
LIMBS = [(5, 7), (7, 9), (6, 8), (8, 10), (5, 6), (11, 12), (5, 11), (6, 12), (11, 13), (13, 15), (12, 14), (14, 16)]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def obscure(frame):
    h, w = frame.shape[:2]
    block = max(16, w // 48)
    small = cv2.resize(frame, (max(1, w // block), max(1, h // block)), interpolation=cv2.INTER_AREA)
    pix = cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)
    return cv2.GaussianBlur(pix, (0, 0), block / 2)


def subject_masks(kps, bat, shape):
    """Returns (tight_body, keep, reliable_count, body_h) in working coordinates.
    tight_body is the subject's own body only (no bat): it is the ONLY area
    allowed to stay visible where another person overlaps - a bystander's
    head beside the bat tip must be obscured even though the bat is kept."""
    h, w = shape
    tight = np.zeros((h, w), np.uint8)
    pts = [(x, y) for x, y, c in kps if c >= KP_CONF]
    if len(pts) < MIN_RELIABLE_KPS:
        return tight, tight.copy(), len(pts), 0.0
    arr = np.array(pts, np.float32)
    body_h = max(40.0, float(arr[:, 1].max() - arr[:, 1].min()))
    limb_w = max(6, int(0.07 * body_h))
    for a, b in LIMBS:
        if kps[a][2] >= KP_CONF and kps[b][2] >= KP_CONF:
            cv2.line(tight, tuple(map(int, kps[a][:2])), tuple(map(int, kps[b][:2])), 255, limb_w)
    torso = [kps[i] for i in (5, 6, 12, 11) if kps[i][2] >= KP_CONF]
    if len(torso) >= 3:
        cv2.fillConvexPoly(tight, np.array([[int(x), int(y)] for x, y, _ in torso], np.int32), 255)
    head = [kps[i] for i in range(5) if kps[i][2] >= KP_CONF]
    if head:
        hx = float(np.mean([p[0] for p in head])); hy = float(np.mean([p[1] for p in head]))
        cv2.circle(tight, (int(hx), int(hy)), max(8, int(0.13 * body_h)), 255, -1)   # helmet
    for i in (9, 10, 15, 16):                                                        # hands, feet
        if kps[i][2] >= KP_CONF:
            cv2.circle(tight, (int(kps[i][0]), int(kps[i][1])), max(5, int(0.05 * body_h)), 255, -1)
    with_bat = tight.copy()
    if bat is not None:
        cv2.line(with_bat, tuple(map(int, bat[0])), tuple(map(int, bat[1])), 255, max(5, int(0.05 * body_h)))
    m = max(3, int(KEEP_MARGIN * body_h))
    keep = cv2.dilate(with_bat, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * m + 1, 2 * m + 1)))
    return tight, keep, len(pts), body_h


def jersey_mask(kps, bat, body_h, shape):
    """Oriented band over the subject's upper torso, following the shoulder->hip
    axis through turns and rotation: covers the back name bar and the chest
    lettering. Only the head is carved out (and only above the shoulder line).
    Arms, hands and bat are NOT carved out: measured on real footage, a limb
    line drawn from keypoints doesn't sit exactly on the limb, so a carve-out
    exposed lettering fragments beside the forearm. They are obscured only
    where they cross this band.
    Returns (mask, method) - method is "torso" or "fallback" (no reliable shoulders)."""
    h, w = shape
    m = np.zeros((h, w), np.uint8)
    ok = lambda i: kps[i][2] >= KP_CONF
    pt = lambda i: np.array(kps[i][:2], np.float64)
    if ok(5) or ok(6):
        shs = [pt(i) for i in (5, 6) if ok(i)]
        ms = np.mean(shs, axis=0)
        hips = [pt(i) for i in (11, 12) if ok(i)]
        mh = np.mean(hips, axis=0) if hips else ms + np.array([0.0, 0.30 * body_h])
        axis = mh - ms
        length = float(np.linalg.norm(axis))
        if length < 1e-3:
            axis, length = np.array([0.0, 1.0]), 0.30 * body_h
        u = axis / length
        n = np.array([-u[1], u[0]])
        span = float(np.linalg.norm(pt(5) - pt(6))) if (ok(5) and ok(6)) else 0.0
        hw = max(JERSEY_HALF_W * span / 2.0, JERSEY_MIN_HALF_W * body_h)
        top = ms - JERSEY_TOP * body_h * u
        bot = ms + JERSEY_BOTTOM * length * u
        quad = np.array([top - hw * n, top + hw * n, bot + hw * n, bot - hw * n], np.int32)
        cv2.fillConvexPoly(m, quad, 255)
        method = "torso"
    else:
        g = [(x, y) for x, y, c in kps if c >= KP_CONF]
        x1, x2 = min(p[0] for p in g), max(p[0] for p in g)
        y1, y2 = min(p[1] for p in g), max(p[1] for p in g)
        cv2.rectangle(m, (int(x1), int(y1 + 0.12 * (y2 - y1))), (int(x2), int(y1 + 0.55 * (y2 - y1))), 255, -1)
        method = "fallback"
    carve = np.zeros((h, w), np.uint8)
    head = [kps[i] for i in range(5) if ok(i)]
    if head and method == "torso":
        cv2.circle(carve, (int(np.mean([k[0] for k in head])), int(np.mean([k[1] for k in head]))), max(6, int(0.11 * body_h)), 255, -1)
        # never carve below the shoulder line: the back name bar sits right there
        below = np.zeros((h, w), np.uint8)
        far = 4.0 * body_h
        cv2.fillConvexPoly(below, np.array([ms - far * n, ms + far * n, ms + far * n + far * u, ms - far * n + far * u], np.int32), 255)
        carve = cv2.bitwise_and(carve, cv2.bitwise_not(below))
    return cv2.bitwise_and(m, cv2.bitwise_not(carve)), method


def helmet_mask(kps, body_h, shape):
    """The helmet carries decals: surname/number on the back, and a script team
    wordmark on the front of the shell above the brim. The whole helmet is
    obscured except a small face window (below the brim, around the nose), so
    head position and eyes stay visible. With no visible face (turned away) the
    whole helmet is obscured. Returns (mask, mode): "face_window", "full", or
    None (no head keypoints)."""
    h, w = shape
    m = np.zeros((h, w), np.uint8)
    ok = lambda i: kps[i][2] >= KP_CONF
    head = [np.array(kps[i][:2], np.float64) for i in range(5) if ok(i)]
    if not head:
        return m, None
    ears = [np.array(kps[i][:2], np.float64) for i in (3, 4) if ok(i)]
    c = np.mean(ears if ears else head, axis=0) - np.array([0.0, HELMET_LIFT * body_h])
    cv2.circle(m, tuple(map(int, c)), max(6, int(HELMET_R * body_h)), 255, -1)
    eyes = [np.array(kps[i][:2], np.float64) for i in (1, 2) if ok(i)]
    if ok(0) and eyes:
        nose = np.array(kps[0][:2], np.float64)
        face = np.zeros((h, w), np.uint8)
        cv2.circle(face, tuple(map(int, nose)), max(4, int(HELMET_FACE_R * body_h)), 255, -1)
        brim_y = int(min(e[1] for e in eyes) - HELMET_BRIM_ABOVE_EYES * body_h)
        face[:max(0, brim_y), :] = 0          # nothing above the brim line is kept
        return cv2.bitwise_and(m, cv2.bitwise_not(face)), "face_window"
    return m, "full"


def letter_candidates(small, zone, body_h, th=LETTER_TH, cr=LETTER_CR, cb=LETTER_CB):
    """Thin bright low-chroma strokes (white/grey lettering on a dark jersey/helmet) inside zone."""
    ycc = cv2.cvtColor(small, cv2.COLOR_BGR2YCrCb)
    k = max(3, int(LETTER_TOPHAT * body_h) | 1)
    top = cv2.morphologyEx(ycc[..., 0], cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))).astype(np.int16)
    c = (top > th) & (np.abs(ycc[..., 1].astype(np.int16) - 128) < cr) & (np.abs(ycc[..., 2].astype(np.int16) - 128) < cb) & (zone > 0)
    return c.astype(np.uint8) * 255


def letter_hulls(cand, body_h):
    return [h for h, _ in letter_components(cand, body_h) if h is not None]


def letter_components(cand, body_h):
    """Merge strokes into words and return one filled, padded outline per word.
    The whole outline is obscured, never just the strokes: a stroke-shaped blur
    would still read as letters."""
    k = max(3, int(LETTER_CLOSE * body_h) | 1)
    closed = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(closed)
    out = []
    for j in range(1, n):
        if stats[j, cv2.CC_STAT_AREA] < LETTER_MIN_PX:
            continue
        pts = np.column_stack(np.nonzero(lab == j)[::-1]).astype(np.int32)
        (_, _), (rw, rh), _ = cv2.minAreaRect(pts)
        if min(rw, rh) < LINE_THIN * body_h and max(rw, rh) > LINE_LONG * body_h:
            out.append((None, "line"))        # piping/trim: long and thin, not lettering
            continue
        out.append((cv2.convexHull(pts), "word"))
    return out


def subject_silhouette(seg_res, kps, shape):
    """The segmentation instance containing most of the subject's reliable keypoints,
    or None when no instance clearly is the subject."""
    h, w = shape
    if seg_res.masks is None or not len(seg_res.masks):
        return None
    pts = [(int(x), int(y)) for x, y, c in kps if c >= KP_CONF and 0 <= int(x) < w and 0 <= int(y) < h]
    if len(pts) < MIN_RELIABLE_KPS:
        return None
    best, best_n = None, 0
    for m in seg_res.masks.data.cpu().numpy():
        mm = cv2.resize((m > 0.5).astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST)
        n = sum(1 for x, y in pts if mm[y, x])
        if n > best_n:
            best, best_n = mm, n
    if best is None or best_n < 0.6 * len(pts):
        return None
    return best * 255


def precise_lettering(video, pose, bat_frames, s, W, H):
    """Pass A of --lettering-mode precise: per frame, the lettering outlines found
    inside the (broad band + helmet) zone restricted to the subject's silhouette.
    Returns {frame: {"hulls", "hull_meta", "anchor", "status", "cand_px", "body_h"}};
    hull_meta[k] = {"helmet": centroid inside the helmet zone, "axial": centroid
    position along shoulder-mid (0) -> hip-mid (1), "area": px} - used to decide
    which outlines may be the jersey NUMBER (see classify_numbers.py)."""
    from ultralytics import YOLO
    seg = YOLO(str(SEG_MODEL))
    cap = cv2.VideoCapture(video)
    out, i = {}, 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        small = cv2.resize(frame, (W, H), interpolation=cv2.INTER_AREA)
        pf = pose["frames"][i] if i < len(pose["frames"]) else {}
        kps = [[x * s, y * s, c] for x, y, c in (pf.get("keypoints") or [])]
        rec = {"hulls": [], "hull_meta": [], "anchor": None, "status": "unreliable", "cand_px": 0}
        if kps:
            _, _, reliable, body_h = subject_masks(kps, None, (H, W))
            if reliable >= MIN_RELIABLE_KPS:
                g = [(x, y) for x, y, c in kps if c >= KP_CONF]
                rec["anchor"] = (float(np.mean([p[0] for p in g])), float(np.mean([p[1] for p in g])))
                sil = subject_silhouette(seg(small, conf=0.25, classes=[0], verbose=False, imgsz=WORK_W, retina_masks=True)[0], kps, (H, W))
                if sil is None:
                    rec["status"] = "no_silhouette"
                else:
                    jz, _ = jersey_mask(kps, None, body_h, (H, W))
                    hz, _ = helmet_mask(kps, body_h, (H, W))
                    zone = cv2.bitwise_and(cv2.bitwise_or(jz, hz), sil)
                    seed = np.zeros((H, W), np.uint8)
                    for w_ in (9, 10):
                        if kps[w_][2] >= KP_CONF:
                            cv2.circle(seed, (int(kps[w_][0]), int(kps[w_][1])), max(4, int(HAND_R * body_h)), 255, -1)
                    bf = bat_frames.get(i)
                    if bf and bf.get("tip"):
                        cv2.line(seed, (int(bf["knob"][0] * s), int(bf["knob"][1] * s)), (int(bf["tip"][0] * s), int(bf["tip"][1] * s)), 255, max(3, int(0.03 * body_h)))
                    main_zone = cv2.bitwise_and(zone, cv2.bitwise_not(seed))
                    cand = letter_candidates(small, main_zone, body_h)
                    hulls = letter_hulls(cand, body_h)
                    # Lettering INSIDE the glove/bat areas still gets covered: its own small
                    # outlines, confined to those areas (so glove panels can't merge with a
                    # whole word), always masked and never eligible as the jersey number.
                    # (Measured: excluding these areas outright left team-name letters
                    # beside the gloves visible.)
                    seed_cand = letter_candidates(small, cv2.bitwise_and(zone, seed), body_h)
                    seed_hulls = letter_hulls(seed_cand, body_h)
                    n_main = len(hulls)
                    hulls = hulls + seed_hulls
                    cand = cv2.bitwise_or(cand, seed_cand)
                    ok_ = lambda j: kps[j][2] >= KP_CONF
                    sh = [np.array(kps[j][:2]) for j in (5, 6) if ok_(j)]
                    hp = [np.array(kps[j][:2]) for j in (11, 12) if ok_(j)]
                    meta = []
                    if sh and hp:
                        v_ = np.mean(hp, axis=0) - np.mean(sh, axis=0)
                        rec["axis_deg"] = round(float(np.degrees(np.arctan2(v_[0], v_[1]))), 2)   # 0 = torso upright
                    for hk, hl in enumerate(hulls):
                        c = hl.reshape(-1, 2).mean(axis=0)
                        ax = None
                        if sh and hp:
                            ms, mh = np.mean(sh, axis=0), np.mean(hp, axis=0)
                            v = mh - ms
                            ax = float(np.dot(c - ms, v) / max(1e-6, np.dot(v, v)))
                        cx, cy = int(np.clip(c[0], 0, W - 1)), int(np.clip(c[1], 0, H - 1))
                        # helmet outline = centroid in the helmet zone AND above the shoulder line
                        (_, _), (rw, rh), _ = cv2.minAreaRect(hl.reshape(-1, 2).astype(np.float32))
                        meta.append({"helmet": bool(hz[cy, cx] > 0 and (ax is None or ax < 0)),
                                     "axial": None if ax is None else round(ax, 3), "area": float(cv2.contourArea(hl)),
                                     "aspect": round(float(max(rw, rh) / max(1e-6, min(rw, rh))), 2),
                                     "glove_or_bat_area": hk >= n_main})
                    rec.update(hulls=hulls, hull_meta=meta, status="ok", cand_px=int((cand > 0).sum()), body_h=body_h)
        out[i] = rec
        i += 1
    cap.release()
    return out


def save_components(pre, path, video_sha):
    json.dump({"version": 1, "source_video_sha256": video_sha,
               "frames": {str(k): {**{x: v[x] for x in v if x != "hulls"}, "hulls": [h.reshape(-1, 2).tolist() for h in v["hulls"]]}
                          for k, v in pre.items()}}, open(path, "w"))


def load_components(path, video_sha):
    d = json.load(open(path))
    if d.get("source_video_sha256") != video_sha:
        sys.exit("FAIL: components cache was computed on a different source video")
    return {int(k): {**v, "hulls": [np.array(h, np.int32).reshape(-1, 1, 2) for h in v["hulls"]]} for k, v in d["frames"].items()}


def precise_mask(pre, i, shape, exempt=None):
    """Frame i's lettering mask: its own outlines plus those of +-LETTER_TEMPORAL
    neighbours shifted by the torso's motion (covers a one-frame detection miss).
    exempt = {frame: set(hull index)} of outlines confirmed as the jersey NUMBER
    (classify_numbers.py); those - and only those - are left visible."""
    m = np.zeros(shape, np.uint8)
    me = pre.get(i)
    if not me:
        return m
    for j in range(i - LETTER_TEMPORAL, i + LETTER_TEMPORAL + 1):
        r = pre.get(j)
        if not r or r["status"] != "ok" or not r["hulls"]:
            continue
        dx, dy = (0.0, 0.0)
        if j != i and me["anchor"] and r["anchor"]:
            dx, dy = me["anchor"][0] - r["anchor"][0], me["anchor"][1] - r["anchor"][1]
        skip = (exempt or {}).get(j, set())
        for k, hl in enumerate(r["hulls"]):
            if k in skip:
                continue
            cv2.fillConvexPoly(m, (hl.reshape(-1, 2) + np.array([dx, dy])).astype(np.int32), 255)
    bh = me.get("body_h") or 0
    k = max(3, int(2 * LETTER_MARGIN * bh) | 1)
    m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    # The current frame's confirmed number stays visible even where a neighbour's
    # (unconfirmed) copy of it or a nearby word's padding would re-cover it. Only
    # the number outline itself is carved - never anything around it.
    for kk in (exempt or {}).get(i, set()):
        num = np.zeros(shape, np.uint8)
        cv2.fillConvexPoly(num, me["hulls"][kk].reshape(-1, 2).astype(np.int32), 255)
        m = cv2.bitwise_and(m, cv2.bitwise_not(num))
    return m


def region_boxes(kps, box, h, w):
    x1, y1, x2, y2 = box
    head_pts = [(x, y) for x, y, c in kps[:5] if c >= 0.2]
    bh = y2 - y1
    if head_pts:
        hx = np.mean([p[0] for p in head_pts]); hy = np.mean([p[1] for p in head_pts])
        r = max(10, 0.12 * bh)
        head = (hx - r, hy - r, hx + r, hy + r)
    else:
        head = (x1, y1, x2, y1 + 0.3 * bh)
    tor = [(x, y) for x, y, c in (kps[i] for i in (5, 6, 11, 12)) if c >= 0.2]
    torso = (min(p[0] for p in tor), min(p[1] for p in tor), max(p[0] for p in tor), max(p[1] for p in tor)) if len(tor) >= 3 \
        else (x1, y1 + 0.25 * bh, x2, y1 + 0.65 * bh)
    clip = lambda b: tuple(int(v) for v in (max(0, b[0]), max(0, b[1]), min(w, b[2]), min(h, b[3])))
    return clip(head), clip(torso)


def identity_break(pose):
    """First frame where the pipeline's subject track jumps in scale or
    position (a switch to another person), or None. Every later frame is
    obscured: re-acquisition is never trusted."""
    prev = None
    for f in pose["frames"]:
        g = [(x, y) for x, y, c in (f.get("keypoints") or []) if c >= KP_CONF]
        if len(g) < MIN_RELIABLE_KPS:
            continue
        cx = sum(p[0] for p in g) / len(g); cy = sum(p[1] for p in g) / len(g)
        h = max(p[1] for p in g) - min(p[1] for p in g)
        if prev:
            pf, px, py, ph = prev
            jump = math.hypot(cx - px, cy - py) / max(ph, 1.0) / max(1, f["frame"] - pf)
            if jump > ID_CENTER_JUMP or max(h, ph) / max(1.0, min(h, ph)) > ID_SCALE_JUMP:
                return f["frame"]
        prev = (f["frame"], cx, cy, h)
    return None


def frac_visible(mask, box):
    x1, y1, x2, y2 = box
    if x2 <= x1 or y2 <= y1:
        return 0.0
    return float((mask[y1:y2, x1:x2] > 0).mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="the exact video the pose pipeline analyzed")
    ap.add_argument("--pose2d", required=True)
    ap.add_argument("--bat", required=True)
    ap.add_argument("--metrics", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--lettering-mode", choices=["broad", "precise"], default="broad",
                    help="broad: torso band + helmet mask (default). precise: obscure only the detected lettering")
    ap.add_argument("--components-cache", help="precise: pass-A lettering outlines; computed and saved if missing, else loaded")
    ap.add_argument("--components-only", action="store_true", help="precise: stop after writing --components-cache")
    ap.add_argument("--number-labels", help="precise: classify_numbers.py output; outlines confirmed as the jersey number stay visible")
    a = ap.parse_args()
    out = pathlib.Path(a.out_dir); out.mkdir(parents=True, exist_ok=True)

    pose = json.load(open(a.pose2d)); meta = pose["meta"]
    bat_frames = {f["frame"]: f for f in json.load(open(a.bat))["frames"]}
    metrics = json.load(open(a.metrics))
    fps = float(meta["fps"]); n_expected = int(meta["n_frames"])
    ph = {k: v.get("time_s") for k, v in (metrics.get("phases") or {}).items() if isinstance(v, dict) and v.get("time_s") is not None}
    id_break = identity_break(pose)
    cutoff_frame = int(math.ceil((max(ph.values()) + POST_SWING_S) * fps)) if ph else None
    cap = cv2.VideoCapture(a.video)
    src_w, src_h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if (src_w, src_h) != (meta["width"], meta["height"]):
        sys.exit(f"FAIL: video is {src_w}x{src_h}, pose_2d was measured on {meta['width']}x{meta['height']}")
    s = WORK_W / src_w
    W, H = WORK_W, int(round(src_h * s / 2) * 2)

    pre, exempt, number_labels = None, {}, None
    if a.lettering_mode == "precise":
        vsha = sha256(a.video)
        if a.components_cache and os.path.exists(a.components_cache):
            pre = load_components(a.components_cache, vsha)
        else:
            pre = precise_lettering(a.video, pose, bat_frames, s, W, H)
            if a.components_cache:
                save_components(pre, a.components_cache, vsha)
        if a.components_only:
            print(json.dumps({"components_cache": a.components_cache, "frames": len(pre)}))
            return
        if a.number_labels:
            number_labels = json.load(open(a.number_labels))
            if number_labels.get("source_video_sha256") != vsha:
                sys.exit("FAIL: number labels were computed on a different source video")
            exempt = {int(k): set(v) for k, v in number_labels["exempt"].items()}
    elif a.components_cache or a.number_labels or a.components_only:
        sys.exit("FAIL: --components-cache/--number-labels need --lettering-mode precise")
    from ultralytics import YOLO
    model = YOLO(str(MODEL))
    model2 = YOLO(str(MODEL2))
    held2 = []          # (last_frame, padded_box) from the second detector
    mp4 = out / f"{a.name}.mp4"
    enc = subprocess.Popen([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", f"{fps:.10f}", "-i", "-",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high",
        "-vf", "scale=out_range=tv,format=yuv420p", "-pix_fmt", "yuv420p", "-color_range", "tv", "-threads", "4",
        "-an", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-movflags", "+faststart", str(mp4),
    ], stdin=subprocess.PIPE)

    held = {}           # track_id -> (last_frame, padded_box)
    bat_holder = {"subject": 0, "other": 0}
    log, sheet_src = [], {}
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        small = cv2.resize(frame, (W, H), interpolation=cv2.INTER_AREA)
        pf = pose["frames"][i] if i < len(pose["frames"]) else {}
        kps = [[x * s, y * s, c] for x, y, c in (pf.get("keypoints") or [])]
        bf = bat_frames.get(i)
        bat = ((bf["knob"][0] * s, bf["knob"][1] * s), (bf["tip"][0] * s, bf["tip"][1] * s)) if bf and bf.get("tip") else None
        if kps:
            tight, keep, reliable, body_h = subject_masks(kps, bat, (H, W))
        else:
            tight = keep = np.zeros((H, W), np.uint8); reliable, body_h = 0, 0.0

        res = model.track(small, persist=True, conf=DET_CONF, classes=[0], verbose=False, tracker="bytetrack.yaml", imgsz=DET_IMGSZ)[0]
        dets = []
        if res.boxes is not None and len(res.boxes):
            ids = res.boxes.id.int().tolist() if res.boxes.id is not None else [-(k + 1) for k in range(len(res.boxes))]
            for box, conf, tid, kp in zip(res.boxes.xyxy.tolist(), res.boxes.conf.tolist(), ids, res.keypoints.data.tolist()):
                dets.append({"box": box, "conf": conf, "id": tid, "kps": kp})
        # Which detection is the subject? Match the pipeline's own keypoints.
        subject_idx, best = None, math.inf
        if reliable >= MIN_RELIABLE_KPS:
            for k, d in enumerate(dets):
                dist = [math.hypot(d["kps"][j][0] - kps[j][0], d["kps"][j][1] - kps[j][1]) for j in range(17) if kps[j][2] >= KP_CONF and d["kps"][j][2] >= 0.2]
                if len(dist) >= 5 and np.median(dist) < best:
                    subject_idx, best = k, float(np.median(dist))
            if subject_idx is not None and best > 0.15 * body_h:
                subject_idx = None
        others = [d for k, d in enumerate(dets) if k != subject_idx]
        # Identity gate: is the pipeline's subject the person holding the tracked bat?
        if bat is not None and reliable >= MIN_RELIABLE_KPS:
            knob = bat[0]
            sub_d = min(math.hypot(kps[w][0] - knob[0], kps[w][1] - knob[1]) for w in (9, 10))
            oth_d = min([math.hypot(d["kps"][w][0] - knob[0], d["kps"][w][1] - knob[1]) for d in others for w in (9, 10) if d["kps"][w][2] >= 0.2] or [math.inf])
            bat_holder["subject" if sub_d <= oth_d else "other"] += 1
        for d in others:
            x1, y1, x2, y2 = d["box"]; px, py = OTHER_PAD * (x2 - x1), OTHER_PAD * (y2 - y1)
            held[d["id"]] = (i, (x1 - px, y1 - py, x2 + px, y2 + py), d["kps"])
        subject_id = dets[subject_idx]["id"] if subject_idx is not None else None
        held.pop(subject_id, None)            # never treat the subject's own track as "other"
        live = {tid: v for tid, v in held.items() if i - v[0] <= HOLD_FRAMES}
        held = live
        # Second detector: every person box not matching the subject is masked (and held) too.
        sub_box = None
        if reliable >= MIN_RELIABLE_KPS:
            g = [(x, y) for x, y, c in kps if c >= KP_CONF]
            sub_box = (min(p[0] for p in g), min(p[1] for p in g), max(p[0] for p in g), max(p[1] for p in g))
        r2 = model2(small, conf=DET_CONF, classes=[0], verbose=False, imgsz=DET_IMGSZ)[0]
        for b in r2.boxes.xyxy.tolist():
            if sub_box:
                ix = max(0, min(b[2], sub_box[2]) - max(b[0], sub_box[0])); iy = max(0, min(b[3], sub_box[3]) - max(b[1], sub_box[1]))
                if ix * iy / max(1.0, (sub_box[2] - sub_box[0]) * (sub_box[3] - sub_box[1])) > 0.5 and ix * iy / max(1.0, (b[2] - b[0]) * (b[3] - b[1])) > 0.4:
                    continue   # this box is the subject
            px, py = OTHER_PAD * (b[2] - b[0]), OTHER_PAD * (b[3] - b[1])
            held2.append((i, (b[0] - px, b[1] - py, b[2] + px, b[3] + py)))
        held2 = [h for h in held2 if i - h[0] <= HOLD_FRAMES]

        other_mask = np.zeros((H, W), np.uint8)
        for tid, (_, box, _) in live.items():
            cv2.rectangle(other_mask, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])), 255, -1)
        for _, box in held2:
            cv2.rectangle(other_mask, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])), 255, -1)
        visible = cv2.bitwise_and(keep, cv2.bitwise_not(cv2.bitwise_and(other_mask, cv2.bitwise_not(tight))))
        flags = []
        if id_break is not None and i >= id_break:
            visible[:] = 0
            flags.append("identity_break_fully_obscured")
        elif cutoff_frame is not None and i >= cutoff_frame:
            visible[:] = 0
            flags.append("post_swing_obscured")
        elif reliable < MIN_RELIABLE_KPS:
            visible[:] = 0
            flags.append("subject_unreliable_fully_obscured")
        elif subject_idx is None:
            flags.append("subject_not_matched_by_detector")
        lettering_px, lettering_method, helmet_mode = 0, None, None
        if reliable >= MIN_RELIABLE_KPS and visible.any():
            if pre is not None and pre.get(i, {}).get("status") == "ok":
                pm = precise_mask(pre, i, (H, W), exempt)
                lettering_method, helmet_mode = "precise", "precise"
                lettering_px = int((cv2.bitwise_and(pm, visible) > 0).sum())
                visible = cv2.bitwise_and(visible, cv2.bitwise_not(pm))
            else:
                if pre is not None:
                    flags.append("precise_lettering_fell_back_to_broad")
                jm, lettering_method = jersey_mask(kps, bat, body_h, (H, W))
                lettering_px = int((cv2.bitwise_and(jm, visible) > 0).sum())
                visible = cv2.bitwise_and(visible, cv2.bitwise_not(jm))
                if lettering_method == "fallback":
                    flags.append("lettering_mask_fallback")
                hm, helmet_mode = helmet_mask(kps, body_h, (H, W))
                lettering_px += int((cv2.bitwise_and(hm, visible) > 0).sum())
                visible = cv2.bitwise_and(visible, cv2.bitwise_not(hm))
        exposures = []
        for tid, (last, box, okps) in live.items():
            head, torso = region_boxes(okps, box, H, W)
            hv, tv = frac_visible(visible, head), frac_visible(visible, torso)
            if hv > HEAD_EXPOSURE_FLAG or tv > TORSO_EXPOSURE_FLAG:
                exposures.append({"track": tid, "head_visible": round(hv, 3), "torso_visible": round(tv, 3), "held": last != i})
        if exposures:
            flags.append("other_person_partly_visible")
        outf = np.where(visible[..., None] > 0, small, obscure(small))
        enc.stdin.write(outf.tobytes())
        log.append({"frame": i, "t": round(i / fps, 4), "subject_reliable_kps": reliable, "subject_track": subject_id,
                    "subject_match_px": None if subject_idx is None else round(best, 1),
                    "other_tracks": sorted(live), "detections": len(dets), "visible_frac": round(float((visible > 0).mean()), 4),
                    "exposures": exposures, "flags": flags, "lettering_masked_px": lettering_px, "lettering_method": lettering_method, "helmet_mask": helmet_mode})
        sheet_src[i] = (outf, small, visible, live, kps)
        i += 1
    enc.stdin.close(); enc.wait()
    if enc.returncode != 0:
        sys.exit("FAIL: encoder error")

    # --- summary + classification --------------------------------------------------
    phases = {k: v.get("time_s") for k, v in (metrics.get("phases") or {}).items() if isinstance(v, dict)}
    pts = [t for t in phases.values() if t is not None]
    win = (min(pts) - 0.2, max(pts) + 0.2) if pts else (0, i / fps)
    in_win = lambda f: win[0] <= f["t"] <= win[1]
    births = [f["frame"] for k, f in enumerate(log) if k and set(f["other_tracks"]) - set(log[k - 1]["other_tracks"])]
    deaths = [f["frame"] for k, f in enumerate(log) if k and set(log[k - 1]["other_tracks"]) - set(f["other_tracks"])]
    subject_id_changes = [f["frame"] for k, f in enumerate(log) if k and f["subject_track"] is not None and log[k - 1]["subject_track"] is not None and f["subject_track"] != log[k - 1]["subject_track"]]
    unreliable = [f["frame"] for f in log if "subject_unreliable_fully_obscured" in f["flags"]]
    lettering_fallback = [f["frame"] for f in log if "lettering_mask_fallback" in f["flags"]]
    precise_fallback = [f["frame"] for f in log if "precise_lettering_fell_back_to_broad" in f["flags"]]
    broken = [f["frame"] for f in log if "identity_break_fully_obscured" in f["flags"]]
    post_swing = [f["frame"] for f in log if "post_swing_obscured" in f["flags"]]
    unmatched = [f["frame"] for f in log if "subject_not_matched_by_detector" in f["flags"]]
    exposed = [f["frame"] for f in log if f["exposures"]]
    head_exposed = [f["frame"] for f in log if any(e["head_visible"] > HEAD_EXPOSURE_FLAG for e in f["exposures"])]
    reasons_reject, reasons_review = [], []
    if id_break is not None:
        inside = in_win(log[min(id_break, len(log) - 1)])
        (reasons_reject if inside else reasons_review).append(
            f"identity: the tracked subject jumps in scale/position (switches person) at frame {id_break} "
            f"({id_break / fps:.2f}s); every later frame is fully obscured"
            + (" - this is INSIDE the analysis phase window, so some stored analysis (phases/pose) is of another person" if inside else ""))
    judged = bat_holder["subject"] + bat_holder["other"]
    holder_frac = bat_holder["subject"] / judged if judged else 0.0
    if judged < 20 or holder_frac < BAT_HOLDER_MIN:
        reasons_reject.append(f"identity: the analyzed subject holds the tracked bat in only {holder_frac:.0%} of {judged} judged frames - the analysis may not be of the batter")
    if i != n_expected:
        reasons_reject.append(f"decoded {i} frames, analysis has {n_expected}")
    if [f for f in unreliable if in_win(log[f])]:
        reasons_reject.append(f"subject unreliable inside the swing window at frames {[f for f in unreliable if in_win(log[f])]}")
    if head_exposed:
        # Another person's head box overlaps the subject's own body outline. The
        # anonymizer cannot know depth (bystander BEHIND the subject = hidden,
        # IN FRONT = exposed), so this is a human visual judgment, never an
        # automatic pass: every such frame is listed for review.
        reasons_review.append(f"{len(head_exposed)} frame(s) where another person's head region overlaps the subject's outline "
                              f"({len([f for f in head_exposed if in_win(log[f])])} in the swing window) - confirm the subject is in front: {head_exposed[:40]}")
    if exposed:
        reasons_review.append(f"{len(exposed)} frame(s) with another person partly inside the subject's keep region")
    if lettering_fallback:
        reasons_review.append(f"{len(lettering_fallback)} frame(s) masked the jersey lettering with the coarse fallback band (shoulders not reliable): {lettering_fallback[:30]}")
    if precise_fallback:
        reasons_review.append(f"{len(precise_fallback)} frame(s) used the broad lettering mask because the precise mode had no subject silhouette: {precise_fallback[:30]}")
    if a.lettering_mode == "precise":
        reasons_review.append("precise lettering mode is a prototype: every frame needs visual confirmation that no lettering survives")
    if unmatched:
        reasons_review.append(f"{len(unmatched)} frame(s) where the detector did not re-find the subject (pipeline keypoints used)")
    if subject_id_changes:
        reasons_review.append(f"subject track id changed at frames {subject_id_changes}")
    if unreliable:
        reasons_review.append(f"{len(unreliable)} frame(s) fully obscured (subject unreliable, outside the swing window)")
    status = "REJECT" if reasons_reject else "NEEDS_MANUAL_REVIEW" if reasons_review else "PASS_CANDIDATE"

    # --- review sheets ---------------------------------------------------------------
    def pick():
        base = {0, i - 1} | set(range(0, i, max(1, i // 10)))
        for t in pts:
            base.add(min(i - 1, int(round(t * fps))))
        risky = sorted(set(exposed) | set(unmatched) | set(subject_id_changes) | set(births) | set(deaths))
        return sorted(base), risky
    base, risky = pick()

    def sheet(frames, debug, path, title):
        frames = frames[:48]
        if not frames:
            return None
        tw = 320; th = int(tw * H / W); cols = 4; rows = math.ceil(len(frames) / cols)
        img = np.full((rows * (th + 18) + 30, cols * tw, 3), 24, np.uint8)
        cv2.putText(img, title, (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
        for k, f in enumerate(frames):
            outf, small, visible, live, kps = sheet_src[f]
            view = outf.copy()
            if debug:
                cnt, _ = cv2.findContours(visible, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                cv2.drawContours(view, cnt, -1, (0, 255, 0), 3)
                for tid, (_, box, _) in live.items():
                    cv2.rectangle(view, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])), (0, 0, 255), 3)
                    cv2.putText(view, str(tid), (int(box[0]) + 4, int(box[1]) + 28), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2)
            y, x = 30 + (k // cols) * (th + 18), (k % cols) * tw
            img[y:y + th, x:x + tw] = cv2.resize(view, (tw, th))
            lab = f"#{f} {log[f]['t']:.2f}s " + (",".join(fl.split("_")[0] for fl in log[f]["flags"]) or "ok")
            cv2.putText(img, lab, (x + 4, y + th + 13), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 200, 255) if log[f]["flags"] else (200, 200, 200), 1)
        cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return path.name

    sheets = {
        "public_view": sheet(base, False, out / f"{a.name}.sheet.jpg", f"{a.name} - PUBLIC VIEW (sampled + phase frames)"),
        "debug_masks": sheet(sorted(set(base) | set(risky[:24])), True, out / f"{a.name}.debug.jpg", f"{a.name} - green=visible region, red=other people (id)"),
        "risk_frames": sheet(risky, False, out / f"{a.name}.risk.jpg", f"{a.name} - every flagged/transition frame, PUBLIC VIEW") if risky else None,
    }
    summary = {
        "name": a.name, "status": status, "reject_reasons": reasons_reject, "review_reasons": reasons_review,
        "source_video_sha256": sha256(a.video), "output": mp4.name, "output_sha256": sha256(mp4),
        "frames": i, "analysis_frames": n_expected, "fps": fps, "output_size": [W, H], "scale_from_analysis_px": s,
        "swing_window_s": [round(win[0], 3), round(win[1], 3)],
        "treatment": {"method": "inverse-mask: keep subject (pipeline pose_2d track) + bat, pixelate+blur everything else; mask other YOLO-tracked people inside keep region",
                      "model": MODEL.name, "second_model": MODEL2.name, "det_conf": DET_CONF, "det_imgsz": DET_IMGSZ, "kp_conf": KP_CONF, "min_reliable_kps": MIN_RELIABLE_KPS,
                      "keep_margin": KEEP_MARGIN, "other_pad": OTHER_PAD, "hold_frames": HOLD_FRAMES, "tracker": "bytetrack", "crop": None,
                      "identity": {"scale_jump": ID_SCALE_JUMP, "center_jump": ID_CENTER_JUMP}, "post_swing_s": POST_SWING_S,
                      "subject_lettering_mask": {"top": JERSEY_TOP, "bottom": JERSEY_BOTTOM, "half_w": JERSEY_HALF_W, "min_half_w": JERSEY_MIN_HALF_W,
                                                 "carve_outs": ["head (above the shoulder line only)"]},
                      "subject_helmet_mask": {"radius": HELMET_R, "lift": HELMET_LIFT, "face_r": HELMET_FACE_R, "brim_above_eyes": HELMET_BRIM_ABOVE_EYES,
                                              "modes": "face_window when the face is visible, else full"},
                      "lettering_mode": a.lettering_mode,
                      "precise_lettering": None if pre is None else {
                          "seg_model": SEG_MODEL.name, "tophat": LETTER_TOPHAT, "th": LETTER_TH, "cr": LETTER_CR, "cb": LETTER_CB,
                          "close": LETTER_CLOSE, "min_px": LETTER_MIN_PX, "line_thin": LINE_THIN, "line_long": LINE_LONG, "hand_r": HAND_R, "margin": LETTER_MARGIN, "temporal": LETTER_TEMPORAL,
                          "zone": "broad jersey band + helmet disc, restricted to the subject's segmented silhouette",
                          "number_labels": None if number_labels is None else {k: number_labels[k] for k in ("rules", "stats") if k in number_labels}}},
        "identity_check": {"track_break_frame": id_break, "post_swing_cutoff_frame": cutoff_frame,
                           "bat_holder": bat_holder, "subject_fraction": round(holder_frac, 3), "min_required": BAT_HOLDER_MIN},
        "counts": {"subject_unreliable_frames": len(unreliable), "subject_unmatched_frames": len(unmatched),
                   "exposure_frames": len(exposed), "head_exposure_frames": len(head_exposed),
                   "track_births": len(births), "track_deaths": len(deaths), "subject_id_changes": len(subject_id_changes)},
        "precise_lettering_frames": None if pre is None else {str(k): {"status": v["status"], "hulls": len(v["hulls"]), "number_visible": sorted(exempt.get(k, [])), "cand_px": v["cand_px"]} for k, v in pre.items()},
        "flagged_frames": {"precise_fallback": precise_fallback, "lettering_fallback": lettering_fallback, "identity_break_obscured": broken, "post_swing_obscured": post_swing, "unreliable": unreliable, "unmatched": unmatched, "exposed": exposed, "births": births, "deaths": deaths},
        "sheets": sheets,
    }
    json.dump(log, open(out / f"{a.name}.frames.json", "w"))
    json.dump(summary, open(out / f"{a.name}.summary.json", "w"), indent=1)
    print(json.dumps({k: summary[k] for k in ("name", "status", "reject_reasons", "review_reasons", "frames", "analysis_frames", "identity_check", "counts")}, indent=1))


if __name__ == "__main__":
    main()
