"""
Validate every frame of a pose_silhouette.py output sequence, not just samples:
for each frame, check the alpha channel forms ONE connected blob above a
reasonable size threshold (catches a disconnected floating limb like the one
a human reviewer caught by eye - this makes that check exhaustive instead of
spot-checked), and check the blob doesn't touch the canvas edge (a proxy for
"the body/swing got clipped by the crop").

Usage: python validate_silhouette.py <dir> <prefix>  (prefix: sil or tgt)
"""
import sys
import glob
import pathlib

import cv2
import numpy as np

out_dir = pathlib.Path(sys.argv[1])
prefix = sys.argv[2]
files = sorted(glob.glob(str(out_dir / f"{prefix}_*.webp")))

bad_frames = []
for f in files:
    im = cv2.imread(f, cv2.IMREAD_UNCHANGED)
    alpha = im[..., 3]
    binary = (alpha > 80).astype(np.uint8)
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    areas = stats[1:, cv2.CC_STAT_AREA] if n_labels > 1 else np.array([])
    significant = areas[areas > 50]  # ignore tiny anti-aliasing specks
    h, w = alpha.shape
    edge_touch = (binary[0, :].any() or binary[-1, :].any() or
                  binary[:, 0].any() or binary[:, -1].any())
    issues = []
    if len(significant) > 1:
        issues.append(f"{len(significant)} disconnected blobs (areas={sorted(significant, reverse=True)[:5]})")
    if len(significant) == 0:
        issues.append("no visible body at all")
    if edge_touch:
        issues.append("silhouette touches the canvas edge (possible clipping)")
    if issues:
        bad_frames.append((pathlib.Path(f).name, issues))

print(f"{prefix}: {len(files)} frames checked, {len(bad_frames)} flagged")
for name, issues in bad_frames:
    print(f"  {name}: {'; '.join(issues)}")
