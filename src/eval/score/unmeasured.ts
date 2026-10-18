import { metric } from './events.ts';
export function unmeasured() {
  const entries: [string[], string][] = [
    [['G4'], 'engine_track_id_unavailable_and_coordinate_transform_unavailable'],
    [['G5'], 'v3_not_evaluated_in_benchmark'], [['G6'], 'requires_v3_and_reliability_profile_S1_10'],
    [['batter_frame_precision', 'batter_frame_recall', 'wrong_athlete_clip_rate', 'fallback_precision'], 'coordinate_transform_unavailable_and_engine_track_id_unavailable'],
    [['identity_switches'], 'engine_track_id_unavailable'],
    [['bat_endpoint_error', 'endpoint_swap_rate', 'PCK_bat_0.1', 'PCK_bat_0.2', 'bat_angle_error', 'bat_recall_by_blur', 'bat_recall_by_speed', 'keypoint_PCK_0.2', 'keypoint_OKS_AP', 'left_right_swap_rate'], 'coordinate_transform_unavailable'],
    [['lead_side_accuracy', 'timebase_VFR_deviation', 'operations_wall_time', 'operations_GPU'], 'not_recorded_in_benchmark_record'],
    [['slice_sport', 'slice_age', 'slice_fps', 'slice_size', 'slice_blur'], 'slice_attribute_not_in_scope'],
    [['risk_coverage_curves', 'selective_accuracy_across_thresholds'], 'threshold_sweep_is_S1_10'], [['AI_layer'], 'S1_11'],
  ];
  return entries.flatMap(([ids, reason]) => ids.map(id => { const { _units, ...m } = metric(id, id.replaceAll('_', ' '), [], { reason, eligibility: 'required source evidence unavailable', missing_prediction_rule: 'unmeasured', missing_annotation_rule: 'unmeasured' }); return m; }));
}
