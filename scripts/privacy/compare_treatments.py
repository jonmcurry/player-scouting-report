"""Side-by-side comparison of two privacy treatments of the same clip (both are
PUBLIC-VIEW derivatives; the source is never shown): a labelled side-by-side
video at the analysis frame rate, and per-phase still pairs (full frame and a
head-to-hips zoom).

  .venv_pose3d/Scripts/python.exe scripts/privacy/compare_treatments.py --a BROAD.mp4 --b PRECISE.mp4 \\
      --label-a "current broad mask" --label-b "precise prototype" --pose2d .../pose_2d.json \\
      --metrics .../metrics.json --out-dir DIR [--extra-phase follow_through=5.3]
"""
import argparse, json, subprocess
import cv2
import numpy as np


def label(img, text):
    cv2.rectangle(img, (0, 0), (img.shape[1], 28), (0, 0, 0), -1)
    cv2.putText(img, text, (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    return img


def main():
    ap = argparse.ArgumentParser()
    for k in ("--a", "--b", "--label-a", "--label-b", "--pose2d", "--metrics", "--out-dir"):
        ap.add_argument(k, required=True)
    ap.add_argument("--extra-phase", action="append", default=[], help="name=time_s for phases the analysis did not mark")
    a = ap.parse_args()
    pose = json.load(open(a.pose2d)); meta = pose["meta"]; fps = float(meta["fps"])
    phases = {k: v["time_s"] for k, v in json.load(open(a.metrics))["phases"].items() if isinstance(v, dict) and v.get("time_s") is not None}
    for e in a.extra_phase:
        k, t = e.split("="); phases[k] = float(t)
    want = {min(int(meta["n_frames"]) - 1, int(round(t * fps))): k for k, t in phases.items()}
    ca, cb = cv2.VideoCapture(a.a), cv2.VideoCapture(a.b)
    W, H = int(ca.get(cv2.CAP_PROP_FRAME_WIDTH)), int(ca.get(cv2.CAP_PROP_FRAME_HEIGHT))
    sbs = f"{a.out_dir}/side-by-side.mp4"
    enc = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
                            "-s", f"{2 * W}x{H}", "-r", f"{fps:.10f}", "-i", "-", "-c:v", "libx264", "-crf", "20",
                            "-pix_fmt", "yuv420p", "-an", "-map_metadata", "-1", "-movflags", "+faststart", sbs], stdin=subprocess.PIPE)
    stills, i = [], 0
    while True:
        oa, fa = ca.read(); ob, fb = cb.read()
        if not (oa and ob):
            break
        t = i / fps
        la = label(fa.copy(), f"{a.label_a}   frame {i}  t={t:.3f}s")
        lb = label(fb.copy(), f"{a.label_b}   frame {i}  t={t:.3f}s")
        enc.stdin.write(np.hstack([la, lb]).tobytes())
        if i in want:
            s = W / meta["width"]
            g = [(x * s, y * s) for x, y, c in pose["frames"][i]["keypoints"] if c >= 0.3]
            x1, x2 = min(p[0] for p in g), max(p[0] for p in g); y1, y2 = min(p[1] for p in g), max(p[1] for p in g)
            h = y2 - y1; cx = (x1 + x2) / 2
            X1, X2 = int(max(0, cx - 0.45 * h)), int(min(W, cx + 0.45 * h)); Y1, Y2 = int(max(0, y1 - 0.12 * h)), int(min(H, y1 + 0.7 * h))
            zoom = [cv2.resize(f[Y1:Y2, X1:X2], None, fx=520 / (Y2 - Y1), fy=520 / (Y2 - Y1), interpolation=cv2.INTER_CUBIC) for f in (fa, fb)]
            zoom = [label(z, f"{n}  {want[i]}  frame {i}") for z, n in zip(zoom, (a.label_a, a.label_b))]
            full = np.hstack([cv2.resize(la, (W // 2, H // 2)), cv2.resize(lb, (W // 2, H // 2))])
            zrow = np.hstack(zoom)
            wmax = max(full.shape[1], zrow.shape[1])
            pad = lambda im: cv2.copyMakeBorder(im, 0, 0, 0, wmax - im.shape[1], cv2.BORDER_CONSTANT)
            p = f"{a.out_dir}/phase-{want[i]}-f{i:03d}.jpg"
            cv2.imwrite(p, np.vstack([pad(full), pad(zrow)]), [cv2.IMWRITE_JPEG_QUALITY, 90])
            stills.append(p)
        i += 1
    enc.stdin.close(); enc.wait()
    print(json.dumps({"frames": i, "side_by_side": sbs, "stills": stills}))


if __name__ == "__main__":
    main()
