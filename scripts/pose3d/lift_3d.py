"""
Stage 2 of the pose3d pipeline: 2D->3D lift via VideoPose3D.

Model choice (per the project spec's own "MotionBERT (preferred) or
VideoPose3D" clause): MotionBERT was evaluated and rejected for this
environment - its pretrained checkpoint is hosted on OneDrive and returns
HTTP 403 to a scripted download (interactive-auth-only, not automatable),
and its documented inference path expects Halpe-26 2D keypoints (via
AlphaPose) rather than COCO-17, which would require installing another
heavy, fragile dependency just for format conversion. VideoPose3D's
pretrained checkpoint (pretrained_h36m_detectron_coco.bin) downloads directly
over plain HTTP from Facebook's public CDN with no auth wall, and - per its
own name and confirmed by reading VideoPose3D_src/data/prepare_data_2d_custom.py
- consumes COCO-17 2D keypoints directly (no reordering), matching this
pipeline's YOLO11-pose output natively.

Architecture (reverse-engineered from the checkpoint's tensor shapes, since
no `args` metadata was saved with it): TemporalModel, filter_widths=[3,3,3,3,3],
channels=1024 -> 243-frame receptive field, 17 COCO 2D joints in -> 17 H36M
3D joints out.

H36M 17-joint output order (verified against VideoPose3D_src/common/
h36m_dataset.py's remove_joints([4,5,9,10,11,16,20,21,22,23,24,28,29,30,31])
call plus its shoulder-parent-rewire, not assumed from memory):
  0 Hip(root) 1 RHip 2 RKnee 3 RAnkle 4 LHip 5 LKnee 6 LAnkle
  7 Thorax 8 Neck 9 Head 10 HeadTop 11 LShoulder 12 LElbow 13 LWrist
  14 RShoulder 15 RElbow 16 RWrist

Handles clips shorter than the 243-frame receptive field via edge-padding
(replicating VideoPose3D's own UnchunkedGenerator behavior: np.pad(...,
'edge') by `pad` frames each side - a fully-convolutional temporal model with
valid-mode convs just needs padding, not a minimum sequence length).

World-frame orientation for coaching angles: the raw model output is in an
arbitrary camera-space frame (no real calibration exists for this ad-hoc
footage - it wasn't shot with known camera extrinsics). Rather than guess
which raw axis is "vertical", this reuses the EXACT fixed dummy rotation
VideoPose3D's own authors apply for their custom/in-the-wild-video visualizer
(common/custom_dataset.py's `custom_camera_params['orientation']`, "taken
from Human3.6M, only for visualization purposes") via `camera_to_world`.
Confirmed (not assumed) that this rotation puts Z vertical: their own
common/visualization.py calls `ax.set_zlim3d([0, radius])` (ground-to-head
range) after this exact rotation, with X/Y symmetric about 0 (horizontal
plane). So after the same rotation: hip/shoulder line orientation in the X-Y
plane gives rotation-about-vertical (this pipeline's hip-shoulder separation
and lead-arm angle), and angle-from-Z gives torso tilt. Joint angles (elbow,
knee) are rotation-invariant so don't depend on this choice at all.

Usage: python lift_3d.py <pose_2d.json> <out_dir>
"""
import sys
import json
import pathlib
import math

import numpy as np
import torch

VP3D_SRC = pathlib.Path(__file__).parent.parent.parent / ".venv_pose3d" / "VideoPose3D_src"
sys.path.insert(0, str(VP3D_SRC))
from common.model import TemporalModel  # noqa: E402
from common.camera import camera_to_world  # noqa: E402
from common.custom_dataset import custom_camera_params  # noqa: E402

CHECKPOINT = VP3D_SRC / "checkpoint" / "pretrained_h36m_detectron_coco.bin"
WORLD_ROTATION = np.array(custom_camera_params["orientation"], dtype=np.float32)

H36M_JOINT_NAMES = [
    "hip", "r_hip", "r_knee", "r_ankle", "l_hip", "l_knee", "l_ankle",
    "thorax", "neck", "head", "head_top",
    "l_shoulder", "l_elbow", "l_wrist",
    "r_shoulder", "r_elbow", "r_wrist",
]
KPS_LEFT = [4, 5, 6, 11, 12, 13]
KPS_RIGHT = [1, 2, 3, 14, 15, 16]

HIP, R_HIP, R_KNEE, R_ANKLE, L_HIP, L_KNEE, L_ANKLE = 0, 1, 2, 3, 4, 5, 6
THORAX, NECK = 7, 8
L_SHOULDER, L_ELBOW, L_WRIST = 11, 12, 13
R_SHOULDER, R_ELBOW, R_WRIST = 14, 15, 16


def line_orientation_xy(p1, p2):
    """Orientation (deg, folded into (-90, 90]) of the line through p1/p2 in the
    world-frame X-Y (horizontal) plane - same fold-mod-180 trick as the earlier
    MediaPipe-era pipeline's line_orientation(), for the same reason: a line has
    no inherent direction, so raw atan2 flips 180deg whenever left/right swap in
    screen space as the body rotates through the swing."""
    d1, d2 = p2[0] - p1[0], p2[1] - p1[1]
    ang = math.degrees(math.atan2(d2, d1)) % 180
    if ang > 90:
        ang -= 180
    return ang


def orientation_diff(a, b):
    d = abs(a - b) % 180
    return min(d, 180 - d)


def joint_angle_3d(a, b, c):
    """Interior angle at point b (3D), formed by rays b->a and b->c, in degrees.
    Rotation-invariant - does not depend on the world-frame orientation choice."""
    v1 = np.array(a) - np.array(b)
    v2 = np.array(c) - np.array(b)
    n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
    if n1 < 1e-9 or n2 < 1e-9:
        return None
    cos_a = np.clip(np.dot(v1, v2) / (n1 * n2), -1.0, 1.0)
    return math.degrees(math.acos(cos_a))


def tilt_from_vertical(p_low, p_high):
    """Angle (deg, 0-90) between the p_low->p_high vector and the world Z axis.
    Sign-agnostic (uses abs) since we don't know if this rig's Z came out
    pointing anatomically up or down after the dummy rotation - only that Z is
    the vertical axis (see module docstring)."""
    v = np.array(p_high) - np.array(p_low)
    n = np.linalg.norm(v)
    if n < 1e-9:
        return None
    cos_a = np.clip(abs(v[2]) / n, -1.0, 1.0)
    return math.degrees(math.acos(cos_a))


def frame_angles(joints):
    """joints: (17, 3) world-frame (Z-up) array for one frame. Returns the
    coaching-angle dict the pipeline spec asks the 3D-lift stage to produce."""
    shoulder_line = line_orientation_xy(joints[L_SHOULDER], joints[R_SHOULDER])
    hip_line = line_orientation_xy(joints[L_HIP], joints[R_HIP])
    hip_shoulder_sep = orientation_diff(shoulder_line, hip_line)

    l_elbow = joint_angle_3d(joints[L_SHOULDER], joints[L_ELBOW], joints[L_WRIST])
    r_elbow = joint_angle_3d(joints[R_SHOULDER], joints[R_ELBOW], joints[R_WRIST])
    l_knee = joint_angle_3d(joints[L_HIP], joints[L_KNEE], joints[L_ANKLE])
    r_knee = joint_angle_3d(joints[R_HIP], joints[R_KNEE], joints[R_ANKLE])
    torso_tilt = tilt_from_vertical(joints[HIP], joints[THORAX])
    # Same tilt_from_vertical() helper used for torso_tilt above, applied to
    # the L_HIP->R_HIP line instead of HIP->THORAX. That line is normally
    # near-horizontal (not vertical) in a standing pose, so its deviation
    # from LEVEL is what a coach means by "pelvis tilt" - the complement of
    # its tilt-from-vertical reading (90deg = perfectly level -> 0deg
    # deviation). Sign-agnostic (0-90, no left/right-higher indication),
    # same convention torso_tilt_from_vertical_deg already uses - not
    # anatomically validated against a known-tilt reference (no ground truth
    # exists for this ad-hoc footage, same caveat every angle here carries).
    hip_line_tilt_from_vertical = tilt_from_vertical(joints[L_HIP], joints[R_HIP])
    pelvis_tilt_from_level = (90.0 - hip_line_tilt_from_vertical
                               if hip_line_tilt_from_vertical is not None else None)

    def r1(v):
        return round(float(v), 2) if v is not None else None

    return {
        "hip_shoulder_separation_deg": r1(hip_shoulder_sep),
        "shoulder_line_deg": r1(shoulder_line),
        "hip_line_deg": r1(hip_line),
        "torso_tilt_from_vertical_deg": r1(torso_tilt),
        "pelvis_tilt_from_level_deg": r1(pelvis_tilt_from_level),
        "l_elbow_angle_deg": r1(l_elbow),
        "r_elbow_angle_deg": r1(r_elbow),
        "l_knee_angle_deg": r1(l_knee),
        "r_knee_angle_deg": r1(r_knee),
    }


def normalize_screen_coordinates(xy, w, h):
    # Matches VideoPose3D's common/camera.py exactly: maps to ~[-1, 1],
    # aspect-ratio-preserving (divides by w for both axes).
    assert xy.shape[-1] == 2
    return xy / w * 2 - np.array([1, h / w])


def build_model():
    model = TemporalModel(
        num_joints_in=17, in_features=2, num_joints_out=17,
        filter_widths=[3, 3, 3, 3, 3], causal=False, dropout=0.25, channels=1024,
    )
    if not CHECKPOINT.exists():
        raise SystemExit(
            f"Missing VideoPose3D checkpoint: {CHECKPOINT}\n"
            f"Download with:\n"
            f'  curl -L -o "{CHECKPOINT}" '
            f"https://dl.fbaipublicfiles.com/video-pose-3d/pretrained_h36m_detectron_coco.bin"
        )
    ckpt = torch.load(str(CHECKPOINT), map_location="cpu", weights_only=False)
    model.load_state_dict(ckpt["model_pos"])
    model.eval()
    if torch.cuda.is_available():
        model = model.cuda()
    return model


def fill_missing(kps_xy, present):
    """Linearly interpolate frames where the batter wasn't tracked (present=False),
    same approach VideoPose3D's own prepare_data_2d_custom.py uses for detection
    gaps. Edge frames with no valid neighbor fall back to nearest present frame."""
    n = len(present)
    idx = np.arange(n)
    present = np.array(present, dtype=bool)
    if not present.any():
        raise SystemExit("No frames with a tracked batter - nothing to lift to 3D.")
    out = kps_xy.copy()
    for j in range(kps_xy.shape[1]):
        for c in range(2):
            out[:, j, c] = np.interp(idx, idx[present], kps_xy[present, j, c])
    return out


def run(pose_2d_path, out_dir):
    pose_2d_path = pathlib.Path(pose_2d_path)
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    data = json.loads(pose_2d_path.read_text())
    meta = data["meta"]
    frames = data["frames"]
    w, h = meta["width"], meta["height"]
    n = len(frames)

    kps_xy = np.zeros((n, 17, 2), dtype=np.float32)
    present = []
    for i, f in enumerate(frames):
        if f["keypoints"] is None:
            present.append(False)
            continue
        present.append(True)
        for j, (x, y, c) in enumerate(f["keypoints"]):
            kps_xy[i, j] = (x, y)

    n_present = sum(present)
    print(f"[lift_3d] {n_present}/{n} frames had a tracked batter (rest interpolated)")
    kps_xy = fill_missing(kps_xy, present)

    kps_norm = normalize_screen_coordinates(kps_xy, w, h).astype(np.float32)

    model = build_model()
    receptive_field = model.receptive_field()
    pad = (receptive_field - 1) // 2
    print(f"[lift_3d] receptive field {receptive_field} frames, edge-pad {pad} each side")

    padded = np.pad(kps_norm, ((pad, pad), (0, 0), (0, 0)), mode="edge")
    inp = torch.from_numpy(padded[np.newaxis, ...])  # (1, n+2*pad, 17, 2)
    if torch.cuda.is_available():
        inp = inp.cuda()

    with torch.no_grad():
        pred = model(inp)  # (1, n, 17, 3), root-relative, camera-space, metric-ish units
    pred = pred.squeeze(0).cpu().numpy()

    assert pred.shape[0] == n, f"expected {n} output frames, got {pred.shape[0]}"

    # Rotate into the same "world" frame (Z-up) VideoPose3D's own custom-video
    # visualizer uses - see module docstring for why this specific rotation.
    # camera_to_world tiles R to match X's leading dims internally.
    pred_world = camera_to_world(pred, R=WORLD_ROTATION, t=0)

    out_frames = []
    for i in range(n):
        joints_i = pred_world[i]
        out_frames.append({
            "frame": i,
            "time_s": frames[i]["time_s"],
            "tracked": present[i],
            "joints": [[round(float(v), 5) for v in joints_i[j]] for j in range(17)],
            "angles": frame_angles(joints_i),
        })

    out = {
        "meta": {**meta, "joint_order": "h36m17", "joint_names": H36M_JOINT_NAMES,
                  "kps_left": KPS_LEFT, "kps_right": KPS_RIGHT,
                  "units": "root-relative, metric-ish (Human3.6M-trained scale, not "
                           "camera-calibrated to this footage - use for angles/ratios, "
                           "not absolute distances)"},
        "frames": out_frames,
    }
    out_path = out_dir / "pose_3d.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"[lift_3d] wrote {out_path}")
    return out


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python lift_3d.py <pose_2d.json> <out_dir>")
        sys.exit(1)
    run(sys.argv[1], sys.argv[2])
