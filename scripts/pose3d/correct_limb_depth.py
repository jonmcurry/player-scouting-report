"""
Corrects a real, measured, systematic depth bias in lift_3d.py's VideoPose3D
output: reconstructed wrists render ~0.2-0.3 (root-relative units) too
low/forward relative to the shoulders, and knees show a parallel backward-Z
bias relative to the hips - confirmed consistent in DIRECTION across every
one of 11 genuinely distinct real clips this project has (never the opposite
sign), and stable WITHIN a clip (frame-to-frame std as low as 0.001-0.09),
not random per-frame noise. Root cause: VideoPose3D was trained on general
Human3.6M motion, not a bat gripped close to the body - a genuinely
out-of-training-distribution pose the model's learned depth regression gets
wrong in a consistent direction for exactly these limb joints. The torso
(hips/spine/neck) is NOT affected - this only touches elbow/wrist/knee/ankle.

Why this is fixable at all: `pose_2d.json`'s own 2D tracking is reliable
for the joints that matter (shoulder/hip confidence 0.91-0.999 across every
clip tested; wrist confidence noisier but still 0.7-0.98 on average) - the
2D detection was never the problem, only the 3D lift's depth for it. This
module trusts the reliable 2D signal over the model's own regression:

  1. Self-calibrate a 2D similarity transform (scale + rotation +
     translation - standard closed-form Procrustes/Kabsch, not a novel
     technique) per frame, from the torso joints that are reliably tracked
     in BOTH the model's native camera-space output and the real 2D pixel
     data: L/R shoulder, L/R hip. Skipped (frame left uncorrected) when
     those 4 anchors are nearly collinear in the 2D frame - e.g. a batter
     turned edge-on to the camera - since the fitted rotation becomes
     unstable in exactly that configuration (see MIN_ANCHOR_EIG_RATIO).
  2. Walk each limb chain outward from the torso (shoulder->elbow->wrist,
     hip->knee->ankle). For each joint whose 2D confidence clears a real
     threshold, reproject its in-plane (X, Y) by inverting the fitted
     transform against its real observed 2D position - trusting the
     reliable 2D detection over the model's regression for that axis.
  3. Resolve depth (Z - the one axis a single 2D view genuinely cannot
     observe) by preserving this clip's own median bone length from the
     already-corrected parent joint - the same rigidity principle already
     proven in this codebase for a different purpose
     (src/services/db/rigidifySkeleton.ts), computed here in Python at the
     source instead of after the fact in the browser. The correct root
     (near vs. far from camera) is picked by staying closest to the
     model's OWN original depth estimate for that joint - the model's
     depth ORDERING is a much weaker claim than its absolute magnitude,
     and a consistent-direction bias (never flips sign) supports trusting
     it for sign/ordering even though it's wrong on magnitude.
  4. Below-threshold-confidence frames are left at the model's original
     position, not guessed - same "low confidence, say so, don't invent
     precision" discipline metrics.py already uses throughout. A One-Euro
     pass (matching this pipeline's existing smoothing convention,
     one_euro_filter.py) smooths the resulting mixed corrected/original
     series so confidence-threshold transitions don't pop visibly.

Operates entirely in lift_3d.py's PRE-world-rotation camera-space (`pred`,
before camera_to_world/WORLD_ROTATION is applied) - the space the model was
actually trained to produce, matching pose_2d.json's own normalization
convention. The caller applies WORLD_ROTATION to the corrected output
exactly as it already does to the uncorrected one; nothing downstream of
lift_3d.py needs to know this correction exists.
"""
import numpy as np

from one_euro_filter import OneEuroFilter

# COCO-17 indices (detect_2d.py's keypoint_names order).
COCO_L_SHOULDER, COCO_R_SHOULDER = 5, 6
COCO_L_ELBOW, COCO_R_ELBOW = 7, 8
COCO_L_WRIST, COCO_R_WRIST = 9, 10
COCO_L_HIP, COCO_R_HIP = 11, 12
COCO_L_KNEE, COCO_R_KNEE = 13, 14
COCO_L_ANKLE, COCO_R_ANKLE = 15, 16

# H36M-17 indices (lift_3d.py's H36M_JOINT_NAMES order).
H_HIP, H_R_HIP, H_R_KNEE, H_R_ANKLE, H_L_HIP, H_L_KNEE, H_L_ANKLE = 0, 1, 2, 3, 4, 5, 6
H_THORAX, H_NECK = 7, 8
H_L_SHOULDER, H_L_ELBOW, H_L_WRIST = 11, 12, 13
H_R_SHOULDER, H_R_ELBOW, H_R_WRIST = 14, 15, 16

TORSO_ANCHORS = [
    (H_L_SHOULDER, COCO_L_SHOULDER), (H_R_SHOULDER, COCO_R_SHOULDER),
    (H_L_HIP, COCO_L_HIP), (H_R_HIP, COCO_R_HIP),
]
ANCHOR_CONF_MIN = 0.5  # torso joints are reliably >0.9 in every clip checked; a low
                        # reading here means something is genuinely wrong with this
                        # frame's 2D tracking, not worth self-calibrating against.

# A real, measured failure mode (Emily_C_AB11-1785696124000, frames ~233-245,
# where she's turned nearly edge-on to the camera mid-play): when the 4 torso
# anchors are nearly collinear in the 2D frame (confirmed - shoulders 3.7px
# apart, hips 9.9px apart in a 1920x1080 image, vs. ~100-200px when facing the
# camera), _fit_similarity_2d's rotation becomes numerically unstable - two
# near-mirror-image rotations fit the anchors themselves almost equally well
# (residual stays low), but reprojecting the LIMBS with the wrong one of the
# two produces anatomically impossible results (measured: elbow angles of
# 19-31deg, near-full flexion, when the real frame shows normal running-motion
# arms). The anchors' own fit residual doesn't reveal this - only checking the
# anchor point cloud's own shape does: the ratio of its two PCA eigenvalues
# (near 0 = nearly collinear/degenerate, near 1 = a well-spread quadrilateral).
# Measured on this same clip: good frames (facing-ish the camera) sit at
# 0.06-0.29; the unstable run of frames sits at 0.005-0.012 - a real, clean
# separation, not a knife's-edge threshold pick.
MIN_ANCHOR_EIG_RATIO = 0.02


def _anchor_condition_ok(dst):
    """True if `dst` (the real 2D torso anchors used to self-calibrate this
    frame) are spread out enough for a 2D similarity fit's rotation to be
    reliably determined - see MIN_ANCHOR_EIG_RATIO's comment. `dst` must
    already have at least 3 points (caller's len(anchor_src) < 3 check)."""
    dst_c = dst - dst.mean(axis=0)
    cov = dst_c.T @ dst_c
    eigvals = np.sort(np.linalg.eigvalsh(cov))
    if eigvals[1] < 1e-12:
        return False
    return (eigvals[0] / eigvals[1]) >= MIN_ANCHOR_EIG_RATIO

# (h36m_idx, coco_idx, parent_h36m_idx) - order matters: a joint's parent must
# already be resolved (torso anchor, or corrected earlier in this same list)
# before it's processed.
LIMB_CHAIN = [
    (H_L_ELBOW, COCO_L_ELBOW, H_L_SHOULDER),
    (H_L_WRIST, COCO_L_WRIST, H_L_ELBOW),
    (H_R_ELBOW, COCO_R_ELBOW, H_R_SHOULDER),
    (H_R_WRIST, COCO_R_WRIST, H_R_ELBOW),
    (H_L_KNEE, COCO_L_KNEE, H_L_HIP),
    (H_L_ANKLE, COCO_L_ANKLE, H_L_KNEE),
    (H_R_KNEE, COCO_R_KNEE, H_R_HIP),
    (H_R_ANKLE, COCO_R_ANKLE, H_R_KNEE),
]
JOINT_CONF_MIN = 0.5  # below this, keep the model's original position for that
                       # frame rather than reprojecting off a shaky 2D detection.

# h36m joint index -> its own coco 2D index, for every joint a bone-length
# measurement might need confidence for (chain joints + their torso anchors).
_H_TO_COCO = dict(TORSO_ANCHORS)
_H_TO_COCO.update((h, c) for h, c, _parent in LIMB_CHAIN)


def _fit_similarity_2d(src, dst):
    """Least-squares 2D similarity transform (scale + rotation/reflection +
    translation) mapping src points to dst points - closed-form via SVD
    (Procrustes/Kabsch). src, dst: (N, 2). Returns (s, R, t) such that
    dst_i ~= s * R @ src_i + t, or None if the points are degenerate
    (coincident/collinear - shouldn't happen with real, distinct shoulder/hip
    joints, but checked rather than assumed)."""
    src_mean = src.mean(axis=0)
    dst_mean = dst.mean(axis=0)
    src_c = src - src_mean
    dst_c = dst - dst_mean

    var_src = (src_c ** 2).sum()
    if var_src < 1e-9:
        return None

    H = src_c.T @ dst_c
    try:
        U, S, Vt = np.linalg.svd(H)
    except np.linalg.LinAlgError:
        return None
    R = Vt.T @ U.T
    s = S.sum() / var_src
    t = dst_mean - s * R @ src_mean
    return s, R, t


def _reproject_inplane(s, R, t, observed_2d):
    """Inverts the fitted similarity transform: given a real observed 2D
    position, returns the (X, Y) in the model's native space that would
    project to it. R is orthogonal, so R^-1 = R.T."""
    return R.T @ ((observed_2d - t) / s)


def _resolve_depth(child_xy, parent_xyz, target_length, child_z_original, parent_z_original):
    """Given the child joint's corrected in-plane (X, Y), the (already
    resolved) parent's full (X, Y, Z), and the target bone length between
    them, solves for the child's Z. Two real roots exist (near/far side of
    the parent) - a single 2D view can't disambiguate that on its own, so
    this picks whichever root stays closest to the model's OWN original Z
    for this joint, trusting the model's depth ORDERING even though its
    magnitude is the thing being corrected.

    If the in-plane distance alone already exceeds the target bone length,
    falls back to the model's own ORIGINAL relative depth offset between
    this joint and its parent (child_z_original - parent_z_original),
    applied onto the parent's corrected depth - not to the parent's exact
    depth (a real, confirmed bug this used to have: forcing a zero offset
    ignores the model's own relative-depth signal entirely, and on
    Emily_C_AB11-1785696124000 frame 65 it left the two wrists nowhere near
    each other in depth even though real 2D tracking shows them together
    gripping the bat - each wrist resolved independently against its own
    elbow, and the right forearm happened to hit exactly this edge case
    while the left didn't). This in-plane-exceeds-target case is a real,
    occasionally-occurring situation on short bone segments (forearm,
    shin) - ordinary per-frame 2D pixel jitter is a bigger fraction of a
    short segment's length than a long one (thigh, upper arm), so it's
    more likely to briefly push the reprojected in-plane distance past
    this clip's own median bone length - not exclusively "a real
    foreshortened limb the model's own reprojected 2D disagrees with" as
    once assumed."""
    dx = child_xy[0] - parent_xyz[0]
    dy = child_xy[1] - parent_xyz[1]
    remaining_sq = target_length ** 2 - dx ** 2 - dy ** 2
    if remaining_sq <= 0:
        return parent_xyz[2] + (child_z_original - parent_z_original)
    dz = remaining_sq ** 0.5
    z_plus, z_minus = parent_xyz[2] + dz, parent_xyz[2] - dz
    return z_plus if abs(z_plus - child_z_original) <= abs(z_minus - child_z_original) else z_minus


def _solve_2bone_ik(shoulder, target, upper_len, fore_len, pole_ref_elbow):
    """Standard 2-bone IK (shoulder->elbow->wrist reaching for `target`) -
    the same technique any game/animation rig uses to plant a hand on an
    object of known position: given the two fixed segment lengths, the
    elbow must lie on a circle around the shoulder->target axis; picking
    where on that circle is the one degree of freedom a 2-bone chain can't
    get from segment lengths alone, resolved here via a "pole vector" - the
    component of the ALREADY-RECONSTRUCTED elbow's own direction that's
    perpendicular to shoulder->target, i.e. trust the model's elbow for
    which way it bends, not for how far it reached. Returns (elbow, wrist);
    wrist lands exactly on `target` unless target is unreachable (clamped
    to the chain's max/min reach)."""
    v = target - shoulder
    raw_d = np.linalg.norm(v)
    # Degenerate case (target ~coincides with the shoulder, or a near-zero
    # bone length from a corrupted clip) - dividing by raw_d/upper_len below
    # would divide by ~0. Real human data never actually puts a grip point
    # on top of a shoulder; this is a defensive floor, not a case expected
    # to fire on real clips - falls back to the pole reference's own
    # direction (or an arbitrary axis if even that's degenerate) rather
    # than fabricating a numeric artifact or propagating a NaN into the
    # rest of this frame's joints.
    if raw_d > 1e-6:
        v_hat = v / raw_d
    else:
        pole_dir = pole_ref_elbow - shoulder
        pole_dir_norm = np.linalg.norm(pole_dir)
        v_hat = pole_dir / pole_dir_norm if pole_dir_norm > 1e-6 else np.array([0.0, -1.0, 0.0])
    upper_len = max(upper_len, 1e-6)
    fore_len = max(fore_len, 1e-6)
    d = min(raw_d, upper_len + fore_len - 1e-6)
    d = max(d, abs(upper_len - fore_len) + 1e-6)
    cos_theta = np.clip((upper_len**2 + d**2 - fore_len**2) / (2 * upper_len * d), -1, 1)
    theta = np.arccos(cos_theta)
    w = pole_ref_elbow - shoulder
    w_perp = w - np.dot(w, v_hat) * v_hat
    if np.linalg.norm(w_perp) < 1e-6:
        arb = np.array([1.0, 0.0, 0.0]) if abs(v_hat[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        w_perp = arb - np.dot(arb, v_hat) * v_hat
    pole_hat = w_perp / np.linalg.norm(w_perp)
    elbow = shoulder + upper_len * (np.cos(theta) * v_hat + np.sin(theta) * pole_hat)
    e_to_t = target - elbow
    wrist = elbow + fore_len * (e_to_t / np.linalg.norm(e_to_t))
    return elbow, wrist


def _converge_bat_grip(corrected, target_length):
    """Real, measured bug found chasing a persistent "doesn't look like a
    real batter" report, much bigger in practice than the per-joint depth
    bias above: even after the per-chain reprojection/depth-resolve, the
    two independently-reconstructed wrists routinely land 0.5-6 SHOULDER
    WIDTHS apart (measured on Emily_C_AB11-1785696124000: every single one
    of 359 frames exceeded 0.5, median 1.4) - anatomically impossible for a
    two-handed bat grip, where real separation is a few cm. Root cause:
    each arm chain is corrected independently, so ordinary per-frame 2D
    jitter and the similarity-fit's own residual - small on their own - get
    amplified by the elbow-to-wrist lever arm, with nothing constraining
    the two chains relative to EACH OTHER. This never shows up as a
    per-joint bone-length violation (each arm's own segment lengths stay
    correct), so the earlier per-limb correction alone can't catch it.

    Fix: exploit real, sport-specific domain knowledge no generic pose
    pipeline would know - both hands stay together on the bat handle for
    essentially this entire clip (this app only ever analyzes a swing
    window, not general activity). Solve each arm as a proper 2-bone IK
    chain (see _solve_2bone_ik) reaching for a shared grip point, using the
    ALREADY-TRUSTED per-clip median upper-arm/forearm lengths and each
    elbow's own reconstructed direction as the pole reference (so which way
    the elbow bends still comes from the model, only the exact reach is
    corrected). Iterates the grip point to its own average wrist position a
    few times to converge, since each arm's solve shifts the shared target
    slightly. Measured on frame 65 of the same clip: wrist separation 0.304
    -> 0.000 (exact convergence, as expected - IK by construction can always
    place both wrists at a reachable shared target), with elbow separation
    dropping from 0.585 (2.5x shoulder width - anatomically impossible for
    a compact grip) to 0.098 (well under half a shoulder width). At
    contact/extension frames elbow separation grows back out to ~1.2-1.3x
    shoulder width - correctly reflects real arm extension toward the ball,
    not a bug this fix reintroduces. Only elbow/wrist positions change;
    shoulders (this function's `corrected` input's torso joints) are
    untouched."""
    n = corrected.shape[0]
    upper_l = target_length[H_L_ELBOW]
    fore_l = target_length[H_L_WRIST]
    upper_r = target_length[H_R_ELBOW]
    fore_r = target_length[H_R_WRIST]

    out = corrected.copy()
    for i in range(n):
        l_sho, l_elb0 = out[i, H_L_SHOULDER], out[i, H_L_ELBOW]
        r_sho, r_elb0 = out[i, H_R_SHOULDER], out[i, H_R_ELBOW]
        grip = (out[i, H_L_WRIST] + out[i, H_R_WRIST]) / 2
        l_elb, l_wri, r_elb, r_wri = l_elb0, out[i, H_L_WRIST], r_elb0, out[i, H_R_WRIST]
        for _ in range(4):
            l_elb, l_wri = _solve_2bone_ik(l_sho, grip, upper_l, fore_l, l_elb0)
            r_elb, r_wri = _solve_2bone_ik(r_sho, grip, upper_r, fore_r, r_elb0)
            grip = (l_wri + r_wri) / 2
        out[i, H_L_ELBOW], out[i, H_L_WRIST] = l_elb, l_wri
        out[i, H_R_ELBOW], out[i, H_R_WRIST] = r_elb, r_wri
    return out


def correct_limb_depth(pred, kps_norm, kps_conf, fps):
    """
    pred: (n, 17, 3) H36M joints, PRE-world-rotation camera-space output
          straight from the model (lift_3d.py's `pred`, before
          camera_to_world is applied).
    kps_norm: (n, 17, 2) COCO 2D keypoints, normalized via lift_3d.py's own
              normalize_screen_coordinates - same convention the model's own
              2D input already uses.
    kps_conf: (n, 17) COCO per-joint detection confidence, 0-1 (from
              pose_2d.json - discarded today by lift_3d.py's own reader,
              the caller must pass it through separately).
    fps: clip frame rate, for the One-Euro smoothing pass.

    Returns a new (n, 17, 3) array - only elbow/wrist/knee/ankle joints
    (LIMB_CHAIN) may differ from `pred`; every other joint (hip, thorax,
    neck, head, shoulders) is returned unchanged, since the torso was never
    the problem. Self-calibration and in-plane reprojection happen per
    frame; bone-length targets need the whole clip, so that's computed once
    up front rather than splitting this into two passes that would have to
    stay in lockstep on chain order/anchor logic.
    """
    n = pred.shape[0]

    # Per-clip reference bone length for each limb segment, from the
    # model's OWN (uncorrected) reconstruction - same principle
    # rigidifySkeleton.ts already uses: a clip's own median is a real,
    # data-derived target, not an assumed anthropometric constant, and stays
    # correct even though individual frames' absolute depth is biased (a
    # consistent bias mostly cancels out of a length/distance computation).
    # Restricted to frames where BOTH endpoints were genuinely 2D-tracked
    # (not fill_missing()'s linear interpolation) - a real, confirmed
    # failure mode on a 13,937-frame clip with only 86 real tracked frames:
    # the median across mostly-interpolated input fed through the temporal
    # model was corrupted enough to leave the correction barely effective.
    target_length = {}
    for h_idx, c_idx, parent_h_idx in LIMB_CHAIN:
        parent_c_idx = _H_TO_COCO[parent_h_idx]
        reliable = (kps_conf[:, c_idx] >= JOINT_CONF_MIN) & (kps_conf[:, parent_c_idx] >= JOINT_CONF_MIN)
        if not reliable.any():
            reliable = slice(None)  # degenerate clip, no genuinely-tracked frames at all - fall back to the old whole-clip behavior rather than crash
        lengths = np.linalg.norm(pred[reliable, h_idx] - pred[reliable, parent_h_idx], axis=1)
        target_length[h_idx] = float(np.median(lengths))

    corrected = pred.copy()
    n_frames_corrected = 0

    for i in range(n):
        anchor_src, anchor_dst = [], []
        for h_idx, c_idx in TORSO_ANCHORS:
            if kps_conf[i, c_idx] >= ANCHOR_CONF_MIN:
                anchor_src.append(pred[i, h_idx, :2])
                anchor_dst.append(kps_norm[i, c_idx])
        if len(anchor_src) < 3:
            continue
        anchor_dst_arr = np.array(anchor_dst)
        if not _anchor_condition_ok(anchor_dst_arr):
            continue
        fit = _fit_similarity_2d(np.array(anchor_src), anchor_dst_arr)
        if fit is None:
            continue
        s, R, t = fit

        frame_touched = False
        for h_idx, c_idx, parent_h_idx in LIMB_CHAIN:
            if kps_conf[i, c_idx] < JOINT_CONF_MIN:
                continue
            xy = _reproject_inplane(s, R, t, kps_norm[i, c_idx])
            parent_xyz = corrected[i, parent_h_idx]
            z = _resolve_depth(xy, parent_xyz, target_length[h_idx], pred[i, h_idx, 2], pred[i, parent_h_idx, 2])
            corrected[i, h_idx] = [xy[0], xy[1], z]
            frame_touched = True
        if frame_touched:
            n_frames_corrected += 1

    print(f"[correct_limb_depth] reprojected limb joints in {n_frames_corrected}/{n} frames "
          f"(rest kept the model's original estimate - insufficient 2D confidence)")

    corrected = _converge_bat_grip(corrected, target_length)

    # One-Euro smoothing per joint per axis, matching this pipeline's
    # existing convention (one_euro_filter.py) - the mix of
    # reprojected-this-frame / kept-original-that-frame can otherwise pop
    # visibly frame to frame.
    smoothed = corrected.copy()
    for h_idx, _c_idx, _parent in LIMB_CHAIN:
        filters = [OneEuroFilter(freq=fps, mincutoff=1.0, beta=0.3) for _ in range(3)]
        for i in range(n):
            for axis in range(3):
                smoothed[i, h_idx, axis] = filters[axis](corrected[i, h_idx, axis], t=i / fps)

    return smoothed
