"""Pure batter-bat association, knob/tip identity and PTS-based temporal tracking.

A frame's tip/knob are set only for a direct, identity-resolved detection. Interpolated geometry is
stored separately and never counts as detected. Nothing is chosen when evidence is ambiguous.
"""
from fractions import Fraction
from math import atan2, degrees, dist
from scripts.engine_v2.identity import PROVISIONAL_BAT_THRESHOLDS as B, PROVISIONAL_THRESHOLDS as T

STATUSES = ("detected", "interpolated", "ambiguous_orientation", "ambiguous_candidate", "missing", "not_evaluated")
# Only an unobserved bat may be bridged; a frame with a competing or unassociated bat is never filled in.
INTERPOLATABLE = {"NO_CANDIDATE", "REJECTED_GEOMETRY", "IMPLAUSIBLE_LENGTH"}


def seconds(frame, other):
    return float((frame["pts"] - other["pts"]) * Fraction(*frame["time_base"]))


def hands(points):
    wrists = [points[i][:2] for i in (9, 10) if points[i][2] >= T["keypoint_conf"]]
    if not wrists:
        return None, False
    return [sum(p[0] for p in wrists) / len(wrists), sum(p[1] for p in wrists) / len(wrists)], len(wrists) == 1


def empty(frame, status, reasons):
    return {"frame": frame["index"], "pts": frame["pts"], "time_s": frame["time_s"], "status": status,
            "reason_codes": sorted(set(reasons)), "tip": None, "knob": None, "conf": None, "track_id": None,
            "knob_source": None, "endpoints": None, "interpolated": None, "length_px": None, "width_px": None,
            "angle_deg": None, "elongation": None, "candidate_count": 0, "fragmented": None}


def _eligible(candidates, hand, height):
    eligible, reasons = [], set()
    for c in candidates:
        if not c["ok"]:
            reasons.add("REJECTED_GEOMETRY")
            continue
        length = c["length_px"] / height
        if length < B["min_length_h"] or length > B["max_length_h"]:
            reasons.add("IMPLAUSIBLE_LENGTH")
            continue
        reach = min(dist(p, hand) for p in c["endpoints"]) / height
        if reach > B["reach_h"]:
            reasons.add("NOT_NEAR_BATTER_HANDS")
            continue
        eligible.append({**c, "reach_h": reach})
    # One physical bat can produce overlapping masks (a full bat and a handle-only fragment). A candidate
    # lying along an already-kept segment is the same bat; keep the longer, more complete observation.
    unique = []
    for c in sorted(eligible, key=lambda c: (-c["length_px"], -c["score"], c["endpoints"])):
        if not any(_same_bat(c, u, height) for u in unique):
            unique.append(c)
    return unique, reasons


def _orientation(endpoints):
    (ax, ay), (bx, by) = endpoints
    return degrees(atan2(by - ay, bx - ax)) % 180


def _same_bat(c, u, height):
    """c lies along u with the same orientation: one physical bat, not two crossing bats."""
    turn = abs(_orientation(c["endpoints"]) - _orientation(u["endpoints"]))
    return (min(turn, 180 - turn) <= B["duplicate_max_angle_deg"]
            and max(_segment_distance(p, u["endpoints"]) for p in c["endpoints"]) / height <= B["duplicate_h"])


def _segment_distance(point, segment):
    (ax, ay), (bx, by) = segment
    dx, dy = bx - ax, by - ay
    span = dx * dx + dy * dy
    t = 0.0 if span == 0 else max(0.0, min(1.0, ((point[0] - ax) * dx + (point[1] - ay) * dy) / span))
    return dist(point, [ax + t * dx, ay + t * dy])


def _continuity_cost(endpoints, previous, height):
    """Cost of each knob assignment against the previous direct knob/tip, in H."""
    return [(dist(endpoints[k], previous["knob"]) + dist(endpoints[1 - k], previous["tip"])) / height for k in (0, 1)]


def track_bats(frames, batter_rows, candidates, failure=None):
    if failure:
        rows = [empty(f, "not_evaluated", ["BAT_STAGE_UNAVAILABLE"]) for f in frames]
        return rows, "unavailable", [failure]
    if not batter_rows:
        return [empty(f, "not_evaluated", ["NO_BATTER_SELECTED"]) for f in frames], "not_evaluated", ["NO_BATTER_SELECTED"]
    rows, last, segment, jumped = [], None, 0, None
    for frame in frames:
        recent = last if last is not None and seconds(frame, last["frame_ref"]) <= B["max_continuity_gap_s"] else None
        if recent is None:
            jumped = None  # The rejected-jump hold never outlives the continuity window, pose or not.
        batter = batter_rows.get(frame["index"])
        found = candidates.get(frame["index"], [])
        if batter is None:
            row = empty(frame, "missing", ["NO_BATTER_POSE"])
            row["candidate_count"] = len(found)
            rows.append(row)
            continue
        box = batter["box_xyxy"]
        height = max(box[3] - box[1], 1e-9)
        hand, single = hands(batter["keypoints17"])
        wrist = ["SINGLE_WRIST"] if single else []
        if hand is None:
            row = empty(frame, "missing", ["NO_CONFIDENT_WRIST"])
            row["candidate_count"] = len(found)
            rows.append(row)
            continue
        eligible, reasons = _eligible(found, hand, height)
        if not eligible:
            row = empty(frame, "missing", (reasons or {"NO_CANDIDATE"}) | set(wrist))
            row["candidate_count"] = len(found)
            rows.append(row)
            continue
        def cost(c):
            return c["reach_h"] + (min(_continuity_cost(c["endpoints"], recent, height)) if recent else 0.0)
        ranked = sorted(eligible, key=lambda c: (cost(c), c["endpoints"]))
        if len(ranked) > 1 and cost(ranked[1]) - cost(ranked[0]) <= B["candidate_margin_h"]:
            row = empty(frame, "ambiguous_candidate", ["MULTIPLE_BAT_CANDIDATES", *wrist])
            row["candidate_count"] = len(found)
            rows.append(row)
            continue
        chosen = ranked[0]
        ends = chosen["endpoints"]
        d0, d1 = dist(ends[0], hand), dist(ends[1], hand)
        by_hands = None if abs(d0 - d1) < B["identity_margin"] * chosen["length_px"] else (0 if d0 < d1 else 1)
        # Continuity only speaks when the bat barely moved: during fast rotation (large endpoint motion
        # per frame) positions cannot tell the ends apart, and the hands alone decide.
        by_time = None
        if recent:
            same, swapped = _continuity_cost(ends, recent, height)
            if (min(same, swapped) <= B["continuity_max_cost_h"]
                    and abs(same - swapped) * height >= B["continuity_margin"] * chosen["length_px"]):
                by_time = 0 if same < swapped else 1
        row = empty(frame, "ambiguous_orientation", [])
        row.update(candidate_count=len(found), conf=None, endpoints=ends, length_px=chosen["length_px"],
                   width_px=chosen["width_px"], angle_deg=chosen["angle_deg"], elongation=chosen["elongation"],
                   fragmented=chosen["fragmented"])
        reasons = list(wrist)
        if by_hands is not None and by_time is not None and by_hands != by_time:
            row["reason_codes"] = sorted(reasons + ["ENDPOINT_FLIP_CONFLICT"])
            rows.append(row)
            continue
        knob = by_hands if by_hands is not None else by_time
        if knob is None:
            row["reason_codes"] = sorted(reasons + ["ENDPOINT_IDENTITY_AMBIGUOUS"])
            rows.append(row)
            continue
        knob_point, tip_point = ends[knob], ends[1 - knob]
        if recent is None:
            segment += 1  # A new bat segment after any gap longer than the continuity window.
        else:
            elapsed = max(seconds(frame, recent["frame_ref"]), B["jump_window_s"])
            too_fast = dist(knob_point, recent["knob"]) / height / elapsed > B["knob_jump_h_per_s"]
            # The rate against a fixed reference falls as time passes, so an object rejected for jumping
            # would otherwise be accepted a frame later. While the trusted bat is recent, anything nearer
            # the rejected position than the trusted bat stays rejected.
            still_jumped = jumped is not None and dist(knob_point, jumped["knob"]) < dist(knob_point, recent["knob"])
            if too_fast or still_jumped:
                # A sudden jump from a recent direct bat is another object or a bad mask, not the same
                # bat: never detected, and continuity keeps the earlier bat. A new segment can start only
                # after the continuity window lapses.
                jumped = {"knob": knob_point}
                row.update(status="ambiguous_candidate", endpoints=None, length_px=None, width_px=None,
                           angle_deg=None, elongation=None, fragmented=None,
                           reason_codes=sorted(reasons + ["BAT_TRACK_DISCONTINUITY"]))
                rows.append(row)
                continue
            jumped = None
        row.update(status="detected", reason_codes=sorted(reasons), knob=knob_point, tip=tip_point,
                   conf=round(chosen["score"], 3), track_id=segment,
                   knob_source="hands" if by_hands is not None else "temporal_continuity")
        rows.append(row)
        last = {"knob": knob_point, "tip": tip_point, "frame_ref": frame}
    _interpolate(rows, frames)
    status = "observed" if any(r["status"] == "detected" for r in rows) else "not_detected"
    return rows, status, []


def _interpolate(rows, frames):
    detected = [i for i, r in enumerate(rows) if r["status"] == "detected"]
    for a, b in zip(detected, detected[1:]):
        if b - a < 2 or rows[a]["track_id"] != rows[b]["track_id"]:
            continue
        if seconds(frames[b], frames[a]) > B["max_interpolation_gap_s"]:
            continue
        between = rows[a + 1:b]
        if not all(r["status"] == "missing" and set(r["reason_codes"]) <= INTERPOLATABLE for r in between):
            continue
        span = seconds(frames[b], frames[a])
        for offset, row in enumerate(between, start=a + 1):
            w = seconds(frames[offset], frames[a]) / span
            point = lambda key: [round(rows[a][key][j] + w * (rows[b][key][j] - rows[a][key][j]), 2) for j in (0, 1)]
            row.update(status="interpolated", interpolated={"knob": point("knob"), "tip": point("tip")},
                       track_id=rows[a]["track_id"], reason_codes=sorted(set(row["reason_codes"]) | {"INTERPOLATED_SHORT_GAP"}))


def summarize(rows, batter_frames):
    counts = {s: sum(r["status"] == s for r in rows) for s in STATUSES}
    detected = counts["detected"]
    return {"counts": counts, "batter_frames": batter_frames,
            "direct_detection_coverage": round(detected / batter_frames, 4) if batter_frames else None}
