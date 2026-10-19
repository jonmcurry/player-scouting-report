"""Pure PTS-based continuity diagnostics; suspected switches always split."""
from math import dist
from fractions import Fraction
from scripts.engine_v2.identity import PROVISIONAL_THRESHOLDS as T


def signature(points):
    if any(points[i][2] < T["keypoint_conf"] for i in (5, 6, 11, 12)):
        return None
    shoulder = [(points[5][j] + points[6][j]) / 2 for j in (0, 1)]
    hip = [(points[11][j] + points[12][j]) / 2 for j in (0, 1)]
    torso = dist(shoulder, hip)
    if torso <= 0:
        return None
    return [dist(points[5][:2], points[6][:2]) / torso,
            dist(points[11][:2], points[12][:2]) / torso]


def split_tracks(observations):
    tracks = {}
    for observation in observations:
        track_id = observation["track_id"]
        # Unassigned detections must never become a shared synthetic track.
        key = str(track_id) if track_id is not None else f"unassigned-{observation['index']}-{len(tracks)}"
        tracks.setdefault(key, []).append(observation)
    segments, events, summaries = [], [], []
    for track_id, rows in tracks.items():
        current, steps = [], []
        for row in rows:
            if current:
                previous = current[-1]
                dt = float((row["pts"] - previous["pts"]) * Fraction(*row["time_base"]))
                a, b = previous["box_xyxy"], row["box_xyxy"]
                ha, hb = max(a[3] - a[1], 1e-9), max(b[3] - b[1], 1e-9)
                time_base = Fraction(*row["time_base"])
                window = Fraction(str(T["centre_jump_window_s"]))
                reference = next((r for r in reversed(current)
                                  if (row["pts"] - r["pts"]) * time_base >= window), current[0])
                reference_box = reference["box_xyxy"]
                reference_height = max(reference_box[3] - reference_box[1], 1e-9)
                elapsed = float((row["pts"] - reference["pts"]) * time_base)
                jump = dist([(reference_box[0]+reference_box[2])/2, (reference_box[1]+reference_box[3])/2],
                            [(b[0]+b[2])/2, (b[1]+b[3])/2]) / reference_height
                scale = max(ha / hb, hb / ha)
                sa, sb = signature(previous["keypoints17"]), signature(row["keypoints17"])
                shift = max(abs(x-y) for x, y in zip(sa, sb)) if sa and sb else None
                # Never divide by less than the window: early in a high-fps segment jitter
                # must not read as speed, while a real swap still exceeds the rate.
                speed = jump / max(elapsed, float(window))
                reasons = []
                if speed > T["centre_jump_heights_per_s"]:
                    reasons.append("CENTRE_JUMP")
                if scale > T["scale_ratio"]: reasons.append("SCALE_JUMP")
                if shift is not None and shift > T["proportion_shift"]: reasons.append("PROPORTION_SHIFT")
                if dt > T["long_gap_s"]: reasons.append("LONG_GAP")
                steps.append({"index": row["index"], "gap_s": dt, "centre_jump_heights": jump,
                              "centre_reference_index": reference["index"], "centre_elapsed_s": elapsed,
                              "centre_jump_heights_per_s": speed, "scale_ratio": scale,
                              "proportion_shift": shift})
                if reasons:
                    events.append({"track_id": track_id, "index": row["index"], "reason_codes": reasons})
                    segments.append({"id": f"{track_id}:{len(segments)}", "track_id": track_id, "rows": current})
                    current = []
            current.append(row)
        segments.append({"id": f"{track_id}:{len(segments)}", "track_id": track_id, "rows": current})
        summaries.append({"track_id": track_id, "frame_indices": [r["index"] for r in rows], "steps": steps,
                          "pose_signatures": [{"index": r["index"], "ratios": signature(r["keypoints17"])} for r in rows]})
    return summaries, segments, events
