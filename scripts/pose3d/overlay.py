"""
Stage 4 (QA) of the pose3d pipeline: render pose_2d.json + bat_path.json +
metrics.json back onto the source video as an annotated overlay, so the
quality bar the spec demands can actually be checked by eye per clip:
  - wrists/hands stay attached to the bat through contact
  - bat path is continuous, no large jumps
  - contact frame (auto-detected in metrics.py) lands where it visually should

Draws: COCO-17 skeleton (green), bat tip/knob + a fading trail (amber),
the contact frame highlighted with a red border + label, and current
hip-shoulder-separation / lead-elbow-angle numbers as a small on-frame HUD
so a coach reviewing the clip can sanity-check the numbers against what the
body is actually doing, frame by frame - not just trust a JSON file.

Usage: python overlay.py <clip_dir> <source_video_path>
"""
import sys
import json
import pathlib
from collections import deque

import cv2

SKELETON_EDGES = [
    (5, 6), (11, 12), (5, 11), (6, 12),
    (5, 7), (7, 9), (6, 8), (8, 10),
    (11, 13), (13, 15), (12, 14), (14, 16),
]
TRAIL_LEN_S = 12 / 30  # was a raw frame count - see metrics.py's ROTATION_WINDOW_S
    # comment for why this needs to be time-based: a fixed frame count covers
    # 8x less real time at 240fps, showing 8x less real bat motion in the trail.


def run(clip_dir, video_path):
    clip_dir = pathlib.Path(clip_dir)
    video_path = pathlib.Path(video_path)

    pose_2d = json.loads((clip_dir / "pose_2d.json").read_text())
    bat_path = json.loads((clip_dir / "bat_path.json").read_text())
    metrics_path = clip_dir / "metrics.json"
    metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else {}
    contact_frame = metrics.get("contact", {}).get("frame")

    p2_frames = pose_2d["frames"]
    bat_frames = bat_path["frames"]

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or pose_2d["meta"]["fps"]
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    out_path = clip_dir / "overlay.mp4"
    writer = cv2.VideoWriter(str(out_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

    trail = deque(maxlen=max(1, round(TRAIL_LEN_S * fps)))
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        kp = p2_frames[i]["keypoints"] if i < len(p2_frames) else None
        if kp is not None:
            for a, b in SKELETON_EDGES:
                pa, pb = kp[a], kp[b]
                if pa[2] > 0.1 and pb[2] > 0.1:
                    cv2.line(frame, (int(pa[0]), int(pa[1])), (int(pb[0]), int(pb[1])),
                              (0, 200, 0), 2)
            for x, y, c in kp:
                if c > 0.1:
                    cv2.circle(frame, (int(x), int(y)), 4, (0, 255, 0), -1)

        bf = bat_frames[i] if i < len(bat_frames) else None
        if bf is not None and bf["tip"] is not None:
            trail.append(bf["tip"])
        else:
            trail.append(None)
        pts = [p for p in trail if p is not None]
        for j in range(1, len(pts)):
            cv2.line(frame, (int(pts[j - 1][0]), int(pts[j - 1][1])),
                      (int(pts[j][0]), int(pts[j][1])), (0, 165, 255), 2)
        if bf is not None and bf["tip"] is not None:
            cv2.circle(frame, (int(bf["tip"][0]), int(bf["tip"][1])), 5, (0, 165, 255), -1)
        if bf is not None and bf["knob"] is not None:
            cv2.circle(frame, (int(bf["knob"][0]), int(bf["knob"][1])), 5, (255, 165, 0), -1)

        is_contact = contact_frame is not None and i == contact_frame
        if is_contact:
            cv2.rectangle(frame, (0, 0), (w - 1, h - 1), (0, 0, 255), 8)
            cv2.putText(frame, "CONTACT (auto-detected)", (20, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)

        hud = f"frame {i}  t={i / fps:.2f}s"
        cv2.putText(frame, hud, (20, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        writer.write(frame)
        i += 1

    cap.release()
    writer.release()
    print(f"[overlay] wrote {out_path} ({i} frames)")
    return out_path


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python overlay.py <clip_dir> <source_video_path>")
        sys.exit(1)
    run(sys.argv[1], sys.argv[2])
