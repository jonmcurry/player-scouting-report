"""Experimental v2 identity and unvalidated, provisional thresholds (M1 person, M2 bat)."""
import hashlib
import json

ENGINE = "hitterloop-engine-v2-exp"
PIPELINE_VERSION = "hitterloop-v2-exp-0.3.0"
DETECTOR_VERSION = "yolo11m-pose+botsort-reid-native+yolo11m-seg-bat"
IDENTITY = {"engine": ENGINE, "pipeline_version": PIPELINE_VERSION}
# M3 events: unvalidated, fixed before any real-clip evaluation. H is the
# selected batter's box height at the current frame; all times use source PTS.
PROVISIONAL_EVENT_THRESHOLDS = {
    "max_derivative_gap_s": 0.10, "min_swing_peak_speed_h_per_s": 4.0,
    "min_swing_rotation_deg": 90.0, "rotation_window_s": 0.25,
    "peak_support_fraction": 0.4, "launch_speed_fraction": 0.25,
    "finish_speed_fraction": 0.15, "finish_sustain_s": 0.10,
    "extension_search_s": 0.30, "stance_search_s": 2.0,
    "stance_still_h_per_s": 0.25, "stance_min_s": 0.30,
    "load_search_s": 1.5, "stride_search_s": 1.5, "foot_lift_h": 0.03,
    "foot_plant_h": 0.015, "foot_plant_still_h_per_s": 0.3, "ankle_conf": 0.5,
    "min_batter_box_fraction": 0.12, "min_bat_length_h": 0.20,
    "foreshortened_fraction": 0.5,
}
EVENT_THRESHOLDS_SHA256 = hashlib.sha256(json.dumps(
    PROVISIONAL_EVENT_THRESHOLDS, sort_keys=True, separators=(",", ":")
).encode()).hexdigest()
# M2.1 selection: unvalidated, fixed before real-clip evaluation.
PROVISIONAL_SELECTION_THRESHOLDS = {
    "min_exclusive_fraction": 0.25, "min_exclusive_span_s": 0.3,
    "min_exclusive_margin": 0.20,
}
SELECTION_THRESHOLDS_SHA256 = hashlib.sha256(json.dumps(
    PROVISIONAL_SELECTION_THRESHOLDS, sort_keys=True, separators=(",", ":")
).encode()).hexdigest()
# Unvalidated: these are engineering hypotheses, not accuracy claims.
PROVISIONAL_THRESHOLDS = {
    "keypoint_conf": 0.5, "box_conf": 0.25,
    "centre_jump_heights_per_s": 5.0, "centre_jump_window_s": 0.03, "scale_ratio": 1.6,
    "proportion_shift": 0.5, "long_gap_s": 0.5,
    "min_duration_s": 0.5, "grip_shoulder_widths": 1.0,
    "min_grip_fraction": 0.6, "min_hands_above_hips_fraction": 0.6,
    "score_margin": 0.15,
}
THRESHOLDS_SHA256 = hashlib.sha256(json.dumps(
    PROVISIONAL_THRESHOLDS, sort_keys=True, separators=(",", ":")
).encode()).hexdigest()
# M2 bat stage. Unvalidated engineering hypotheses; lengths are in batter-box heights (H),
# rates in H per PTS second, times in PTS seconds.
PROVISIONAL_BAT_THRESHOLDS = {
    "model_conf": 0.10, "min_pixels": 40, "trim_percent": 0.1,
    "max_isotropy": 0.8, "min_elongation": 3.0, "fragment_min_fraction": 0.05, "fragment_max_gap_widths": 4.0,
    "min_length_h": 0.10, "max_length_h": 1.0, "reach_h": 0.25,
    "duplicate_h": 0.05, "duplicate_max_angle_deg": 15.0, "candidate_margin_h": 0.10,
    "identity_margin": 0.20, "continuity_margin": 0.20, "continuity_max_cost_h": 0.5, "max_continuity_gap_s": 0.10,
    "knob_jump_h_per_s": 12.0, "jump_window_s": 0.03, "max_interpolation_gap_s": 0.10,
}
BAT_THRESHOLDS_SHA256 = hashlib.sha256(json.dumps(
    PROVISIONAL_BAT_THRESHOLDS, sort_keys=True, separators=(",", ":")
).encode()).hexdigest()
KEYPOINT_NAMES = ["nose", "l_eye", "r_eye", "l_ear", "r_ear",
                  "l_shoulder", "r_shoulder", "l_elbow", "r_elbow",
                  "l_wrist", "r_wrist", "l_hip", "r_hip", "l_knee",
                  "r_knee", "l_ankle", "r_ankle"]


class Unavailable(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason
