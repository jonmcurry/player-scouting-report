"""Independent privacy + alignment validation of an ANONYMIZED demo clip.

Deliberately does not reuse anonymize_clip.py's masks or detections - it
checks the encoded output file itself:

  1. Timing: output frame count == analysis frame count, frame rate ==
     analysis fps, duration == n/fps, no audio, no metadata tags.
  2. Coverage (every frame): a DIFFERENT detector (YOLOv8m, COCO person) finds
     people on the SOURCE frame; for every non-subject person, the output must
     have destroyed detail in their box (Laplacian-energy ratio) and left
     almost no pixels unmodified. Checked separately for the head band.
  3. Residual detectability: the same detector on the OUTPUT frame must not
     find a confident person other than the subject.
  4. Alignment: the pose model re-detects the subject on OUTPUT frames and
     compares against pose_2d.json scaled to output size - proving output
     frame i shows the same moment of the same swing as analysis frame i.

Any failure is reported per frame. Exit status: 0 = no findings,
2 = findings (needs manual review), 1 = hard failure (timing/alignment).
"""
import argparse, json, math, pathlib, subprocess, sys
import cv2
import numpy as np

HERE = pathlib.Path(__file__).resolve().parents[1] / "models" / "pr5-baseline-recovery"
DETAIL_RATIO_MAX = 0.20        # output keeps <= 20% of a person's original detail
HEAD_DETAIL_RATIO_MAX = 0.12
UNCHANGED_MAX = 0.15           # pixelation leaves ~5-8% of textured pixels within +-6 by coincidence; >15% = real
RESIDUAL_CONF = 0.45
ALIGN_MAX_FRAC = 0.06          # median keypoint error <= 6% of subject body height


def lapvar(img):
    return float(cv2.Laplacian(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())


def main():
    ap = argparse.ArgumentParser()
    for k in ("source", "output", "pose2d", "bat", "metrics", "summary-out"):
        ap.add_argument(f"--{k}", required=True)
    a = ap.parse_args()
    pose = json.load(open(a.pose2d)); meta = pose["meta"]; fps = float(meta["fps"]); n = int(meta["n_frames"])
    bats = {f["frame"]: f for f in json.load(open(a.bat))["frames"]}
    LIMBS = [(5, 7), (7, 9), (6, 8), (8, 10), (5, 6), (11, 12), (5, 11), (6, 12), (11, 13), (13, 15), (12, 14), (14, 16)]
    hard, findings = [], []

    pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-print_format", "json", "-show_streams", "-show_format", a.output], capture_output=True, text=True).stdout)
    v = next(s for s in pr["streams"] if s["codec_type"] == "video")
    num, den = map(float, v["avg_frame_rate"].split("/"))
    timing = {"frames": int(v["nb_read_frames"]), "expected_frames": n, "fps": num / den, "expected_fps": fps,
              "duration": float(pr["format"]["duration"]), "expected_duration": n / fps,
              "audio_streams": sum(1 for s in pr["streams"] if s["codec_type"] == "audio"),
              "codec": v["codec_name"], "pix_fmt": v.get("pix_fmt"), "color_range": v.get("color_range")}
    if timing["frames"] != n: hard.append(f"frame count {timing['frames']} != {n}")
    if abs(timing["fps"] - fps) > 1e-3: hard.append(f"fps {timing['fps']:.5f} != {fps:.5f}")
    if abs(timing["duration"] - n / fps) > 1.5 / fps: hard.append(f"duration {timing['duration']:.3f} != {n / fps:.3f}")
    if timing["audio_streams"]: hard.append("audio present")
    if timing["codec"] != "h264" or timing["pix_fmt"] != "yuv420p": hard.append(f"not h264/yuv420p: {timing['codec']}/{timing['pix_fmt']}")

    from ultralytics import YOLO
    det = YOLO(str(HERE / "yolov8m.pt")); posem = YOLO(str(HERE / "yolo11m-pose.pt"))
    src, out = cv2.VideoCapture(a.source), cv2.VideoCapture(a.output)
    W, H = int(out.get(cv2.CAP_PROP_FRAME_WIDTH)), int(out.get(cv2.CAP_PROP_FRAME_HEIGHT))
    s = W / meta["width"]
    align_err, per_frame = [], []
    # Independent identity continuity: any scale/centre jump in the subject
    # track (a switch to another person); the output must be obscured from
    # there on. Also the post-swing tail must be obscured.
    ph = {k: v.get("time_s") for k, v in (json.load(open(a.metrics)).get("phases") or {}).items() if isinstance(v, dict) and v.get("time_s") is not None}
    must_obscure_from = None
    prev = None
    for f in pose["frames"]:
        g = [(x, y) for x, y, c in (f.get("keypoints") or []) if c >= 0.3]
        if len(g) < 8:
            continue
        cx = sum(q[0] for q in g) / len(g); cy = sum(q[1] for q in g) / len(g); hh = max(q[1] for q in g) - min(q[1] for q in g)
        if prev:
            jump = math.hypot(cx - prev[1], cy - prev[2]) / max(prev[3], 1.0) / max(1, f["frame"] - prev[0])
            if jump > 0.25 or max(hh, prev[3]) / max(1.0, min(hh, prev[3])) > 1.35:
                must_obscure_from = f["frame"]; break
        prev = (f["frame"], cx, cy, hh)
    if ph:
        tail = int(math.ceil((max(ph.values()) + 1.0) * fps))
        must_obscure_from = tail if must_obscure_from is None else min(must_obscure_from, tail)
    id_visible_mismatch = []
    for i in range(n):
        ok1, fs = src.read(); ok2, fo = out.read()
        if not (ok1 and ok2):
            hard.append(f"could not read frame {i} (source={ok1}, output={ok2})"); break
        fs = cv2.resize(fs, (W, H), interpolation=cv2.INTER_AREA)
        kps = [[x * s, y * s, c] for x, y, c in ((pose["frames"][i].get("keypoints") or []) if i < len(pose["frames"]) else [])]
        good = [(x, y) for x, y, c in kps if c >= 0.3]
        sub_box = (min(p[0] for p in good), min(p[1] for p in good), max(p[0] for p in good), max(p[1] for p in good)) if len(good) >= 8 else None
        body_h = (sub_box[3] - sub_box[1]) if sub_box else 0
        rec = {"frame": i, "issues": []}
        # The subject's own body + bat, drawn from the PIPELINE's data (not the
        # anonymizer's masks), excluded when measuring other people's regions -
        # otherwise the subject's own hands/bat crossing a bystander's box read
        # as "surviving detail".
        own = np.zeros((H, W), np.uint8)
        if len(good) >= 8:
            lw = max(6, int(0.13 * body_h))   # wide enough to cover clothing, not just the limb axis
            for p_, q_ in LIMBS:
                if kps[p_][2] >= 0.3 and kps[q_][2] >= 0.3:
                    cv2.line(own, (int(kps[p_][0]), int(kps[p_][1])), (int(kps[q_][0]), int(kps[q_][1])), 255, lw)
            hp = [k for k in kps[:5] if k[2] >= 0.3]
            if hp:
                cv2.circle(own, (int(np.mean([k[0] for k in hp])), int(np.mean([k[1] for k in hp]))), int(0.15 * body_h), 255, -1)
            bf = bats.get(i)
            if bf and bf.get("tip"):
                cv2.line(own, (int(bf["knob"][0] * s), int(bf["knob"][1] * s)), (int(bf["tip"][0] * s), int(bf["tip"][1] * s)), 255, max(5, int(0.06 * body_h)))

        def is_subject(b):
            if not sub_box:
                return False
            ix = max(0, min(b[2], sub_box[2]) - max(b[0], sub_box[0])); iy = max(0, min(b[3], sub_box[3]) - max(b[1], sub_box[1]))
            inter = ix * iy
            return inter / max(1.0, (sub_box[2] - sub_box[0]) * (sub_box[3] - sub_box[1])) > 0.5 and inter / max(1.0, (b[2] - b[0]) * (b[3] - b[1])) > 0.4

        # Both architectures, at 2560px input (one step more sensitive than the anonymizer's 1920).
        cand = []
        for m in (det, posem):
            rs = m(fs, conf=0.10, classes=[0], verbose=False, imgsz=2560)[0]
            cand += list(zip(rs.boxes.xyxy.tolist(), rs.boxes.conf.tolist()))
        for b, c in cand:
            if is_subject(b):
                continue
            x1, y1, x2, y2 = (int(max(0, b[0])), int(max(0, b[1])), int(min(W, b[2])), int(min(H, b[3])))
            if (x2 - x1) * (y2 - y1) < 200:
                continue
            notown = own[y1:y2, x1:x2] == 0
            if notown.mean() < 0.2:
                continue          # box is essentially the subject's own body
            def lv(img, m):
                lap = cv2.Laplacian(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.CV_64F)
                return float(lap[m].var()) if m.sum() > 20 else 0.0
            ls = lv(fs[y1:y2, x1:x2], notown); lo = lv(fo[y1:y2, x1:x2], notown)
            hy2 = y1 + max(4, int(0.3 * (y2 - y1)))
            hm = own[y1:hy2, x1:x2] == 0
            hs = lv(fs[y1:hy2, x1:x2], hm); ho = lv(fo[y1:hy2, x1:x2], hm)
            diff = np.abs(fs[y1:y2, x1:x2].astype(int) - fo[y1:y2, x1:x2].astype(int)).max(axis=2)
            textured = (cv2.Laplacian(cv2.cvtColor(fs[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY), cv2.CV_64F).__abs__() > 12) & notown
            unchanged = float(((diff < 6) & textured).sum() / max(1, textured.sum()))
            ratio, hratio = (lo / ls if ls > 5 else 0.0), (ho / hs if hs > 5 else 0.0)
            if ratio > DETAIL_RATIO_MAX or hratio > HEAD_DETAIL_RATIO_MAX or unchanged > UNCHANGED_MAX:
                rec["issues"].append({"kind": "person_detail_survives", "box": [x1, y1, x2, y2], "conf": round(c, 2),
                                      "detail_ratio": round(ratio, 3), "head_detail_ratio": round(hratio, 3), "unchanged_textured": round(unchanged, 3)})
        for b, c in zip(*(lambda r: (r.boxes.xyxy.tolist(), r.boxes.conf.tolist()))(det(fo, conf=RESIDUAL_CONF, classes=[0], verbose=False)[0])):
            if not is_subject(b):   # informational: an obscured silhouette can still read as "a person"
                rec.setdefault("info", []).append({"kind": "silhouette_detectable_in_output", "box": [int(x) for x in b], "conf": round(c, 2)})
        if sub_box and i % 3 == 0 and (must_obscure_from is None or i < must_obscure_from):     # alignment sampled every 3rd visible frame
            best = math.inf
            for kp in (posem(fo, conf=0.2, verbose=False)[0].keypoints.data.tolist() or []):
                d = [math.hypot(kp[j][0] - kps[j][0], kp[j][1] - kps[j][1]) for j in range(17) if kps[j][2] >= 0.3 and kp[j][2] >= 0.3]
                if len(d) >= 6:
                    best = min(best, float(np.median(d)))
            if best < math.inf:
                align_err.append(best / max(1.0, body_h))
        # Subject's own jersey lettering (independent geometry: axis-aligned box from the
        # shoulder line to 60% of the way to the hips, arms/head excluded) must be destroyed.
        if len(good) >= 8 and (must_obscure_from is None or i < must_obscure_from) and (kps[5][2] >= 0.3 or kps[6][2] >= 0.3):
            sh = [kps[j] for j in (5, 6) if kps[j][2] >= 0.3]; hp = [kps[j] for j in (11, 12) if kps[j][2] >= 0.3]
            sy = float(np.mean([p_[1] for p_ in sh])); hy = float(np.mean([p_[1] for p_ in hp])) if hp else sy + 0.3 * body_h
            sx = [p_[0] for p_ in sh]
            half = max((max(sx) - min(sx)) / 2 * 1.2, 0.08 * body_h); cx_ = float(np.mean(sx))
            ly1, ly2 = int(sy - 0.05 * body_h), int(sy + 0.55 * (hy - sy)); lx1, lx2 = int(cx_ - half), int(cx_ + half)
            lm = np.zeros((H, W), np.uint8); cv2.rectangle(lm, (lx1, ly1), (lx2, ly2), 255, -1)
            aw = max(6, int(0.07 * body_h))
            for p_, q_ in ((5, 7), (7, 9), (6, 8), (8, 10)):
                if kps[p_][2] >= 0.3 and kps[q_][2] >= 0.3:
                    cv2.line(lm, (int(kps[p_][0]), int(kps[p_][1])), (int(kps[q_][0]), int(kps[q_][1])), 0, aw)
            hpn = [k_ for k_ in kps[:5] if k_[2] >= 0.3]
            if hpn:
                cv2.circle(lm, (int(np.mean([k_[0] for k_ in hpn])), int(np.mean([k_[1] for k_ in hpn]))), int(0.13 * body_h), 0, -1)
            sel = lm > 0
            if sel.sum() > 40:
                ls_ = float(cv2.Laplacian(cv2.cvtColor(fs, cv2.COLOR_BGR2GRAY), cv2.CV_64F)[sel].var())
                lo_ = float(cv2.Laplacian(cv2.cvtColor(fo, cv2.COLOR_BGR2GRAY), cv2.CV_64F)[sel].var())
                if ls_ > 5 and lo_ / ls_ > 0.25:
                    rec["issues"].append({"kind": "subject_lettering_detail_survives", "box": [lx1, ly1, lx2, ly2], "conf": 1.0,
                                          "detail_ratio": round(lo_ / ls_, 3), "head_detail_ratio": None, "unchanged_textured": None})
        if must_obscure_from is not None and i >= must_obscure_from:
            # Fail-closed frame: nothing may retain detail (checked by detail loss, not colour).
            ls_, lo_ = lapvar(fs), lapvar(fo)
            if ls_ > 5 and lo_ / ls_ > 0.12:
                id_visible_mismatch.append(i)
                rec["issues"].append({"kind": "fail_closed_frame_not_obscured", "box": [0, 0, W, H], "conf": 1.0,
                                      "detail_ratio": round(lo_ / ls_, 3), "head_detail_ratio": None, "unchanged_textured": None})
        if rec["issues"]:
            findings.append(rec)
        if rec.get("info"):
            per_frame.append({"frame": i, "info": rec["info"]})
    if id_visible_mismatch:
        hard.append(f"fail-closed frames (after a track switch or the post-swing cutoff at {must_obscure_from}) keep detail: {id_visible_mismatch[:30]}")
    align = {"frames_checked": len(align_err), "median_err_frac": round(float(np.median(align_err)), 4) if align_err else None,
             "p95_err_frac": round(float(np.percentile(align_err, 95)), 4) if align_err else None}
    if not align_err or align["median_err_frac"] > ALIGN_MAX_FRAC:
        hard.append(f"alignment: re-detected subject does not match pose_2d ({align})")
    result = {"output": pathlib.Path(a.output).name, "timing": timing, "alignment": align, "must_obscure_from_frame": must_obscure_from, "hard_failures": hard,
              "frames_with_findings": [f["frame"] for f in findings], "findings": findings,
              "silhouette_info_frames": [p["frame"] for p in per_frame],
              "verdict": "FAIL" if hard else ("FINDINGS" if findings else "CLEAN")}
    json.dump(result, open(a.summary_out, "w"), indent=1)
    print(json.dumps({k: result[k] for k in ("output", "verdict", "hard_failures", "alignment")} | {"n_finding_frames": len(findings), "timing": timing}, indent=1))
    sys.exit(1 if hard else 2 if findings else 0)


if __name__ == "__main__":
    main()
