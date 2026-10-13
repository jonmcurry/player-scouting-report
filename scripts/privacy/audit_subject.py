"""Subject-identity audit for a processed clip (LOCAL REVIEW ONLY - draws on
unobscured frames; the output must never be published).

Draws the pose pipeline's own tracked subject (pose_2d.json skeleton, yellow)
and tracked bat (bat_path.json, cyan) on sampled frames of the exact video the
pipeline analyzed, and measures per frame whether the tracked bat's knob is
nearer the subject's wrists than any other detected person's wrists - i.e.
whether the pipeline's "batter" is actually the person holding the bat.
"""
import argparse, json, math, pathlib
import cv2
import numpy as np

MODEL = pathlib.Path(__file__).resolve().parents[1] / "models" / "pr5-baseline-recovery" / "yolo11m-pose.pt"
LIMBS = [(5, 7), (7, 9), (6, 8), (8, 10), (5, 6), (11, 12), (5, 11), (6, 12), (11, 13), (13, 15), (12, 14), (14, 16)]


def main():
    ap = argparse.ArgumentParser()
    for k in ("video", "pose2d", "bat", "out", "name"):
        ap.add_argument(f"--{k}", required=True)
    a = ap.parse_args()
    pose = json.load(open(a.pose2d)); bats = {f["frame"]: f for f in json.load(open(a.bat))["frames"]}
    n = pose["meta"]["n_frames"]; s = 640 / pose["meta"]["width"]
    from ultralytics import YOLO
    model = YOLO(str(MODEL))
    cap = cv2.VideoCapture(a.video)
    picks = set(np.linspace(0, n - 1, 12).astype(int).tolist())
    tiles, holder = [], {"subject": 0, "other": 0, "no_bat": 0}
    for i in range(n):
        ok, fr = cap.read()
        if not ok:
            break
        kps = (pose["frames"][i].get("keypoints") or []) if i < len(pose["frames"]) else []
        bf = bats.get(i)
        if bf and bf.get("knob") and kps:
            knob = bf["knob"]
            sub_d = min(math.hypot(kps[w][0] - knob[0], kps[w][1] - knob[1]) for w in (9, 10))
            big = cv2.resize(fr, (1280, int(1280 * fr.shape[0] / fr.shape[1])))
            k2 = 1280 / fr.shape[1]
            r = model(big, conf=0.2, classes=[0], verbose=False)[0]
            other_d = math.inf
            for kp in (r.keypoints.data.tolist() if r.keypoints is not None else []):
                d_sub = np.median([math.hypot(kp[j][0] / k2 - kps[j][0], kp[j][1] / k2 - kps[j][1]) for j in range(17)])
                if d_sub < 0.05 * fr.shape[1]:  # this detection IS the subject
                    continue
                other_d = min(other_d, *(math.hypot(kp[w][0] / k2 - knob[0], kp[w][1] / k2 - knob[1]) for w in (9, 10)))
            holder["subject" if sub_d <= other_d else "other"] += 1
        else:
            holder["no_bat"] += 1
        if i in picks:
            t = cv2.resize(fr, (640, int(640 * fr.shape[0] / fr.shape[1])))
            for p, q in LIMBS:
                if kps and kps[p][2] > 0.3 and kps[q][2] > 0.3:
                    cv2.line(t, (int(kps[p][0] * s), int(kps[p][1] * s)), (int(kps[q][0] * s), int(kps[q][1] * s)), (0, 255, 255), 2)
            if bf and bf.get("tip"):
                cv2.line(t, (int(bf["knob"][0] * s), int(bf["knob"][1] * s)), (int(bf["tip"][0] * s), int(bf["tip"][1] * s)), (255, 255, 0), 3)
            cv2.putText(t, f"#{i}", (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            tiles.append(t)
    th = tiles[0].shape[0]
    rows = [np.hstack(tiles[k:k + 4] + [np.zeros_like(tiles[0])] * (4 - len(tiles[k:k + 4]))) for k in range(0, len(tiles), 4)]
    cv2.imwrite(a.out, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 80])
    print(json.dumps({"name": a.name, "bat_knob_nearest": holder}))


if __name__ == "__main__":
    main()
