"""Pure provisional events on final, direct observations. No contact claims.

Derivatives never bridge a missing source frame, missing observation, bat track
boundary or PTS gap above the fixed limit. No endpoint other than tip is read.
"""
from fractions import Fraction
from math import cos, sin, radians, dist, hypot
from statistics import median
from scripts.engine_v2.identity import PROVISIONAL_EVENT_THRESHOLDS as T, PROVISIONAL_THRESHOLDS

EVENT_IDS = ("stance_set", "load_start", "load_peak_estimate", "stride_foot_lift",
             "foot_plant", "swing_launch", "impact_estimate", "contact_confirmed", "extension", "finish")
PHASE_EVENTS = dict(zip(("stance", "load", "stride", "contact", "extension", "follow_through"),
                       ("stance_set", "load_peak_estimate", "foot_plant", "impact_estimate", "extension", "finish")))
ORDER = (("stance_set", "swing_launch"), ("load_peak_estimate", "swing_launch"), ("stance_set", "load_peak_estimate"),
         ("stride_foot_lift", "foot_plant"), ("stride_foot_lift", "swing_launch"),
         ("swing_launch", "impact_estimate"), ("impact_estimate", "finish"))
# Definition-limited events (see engine-v2-m3.md): computed and reported, not for downstream use.
NOT_RECOMMENDED = {"swing_launch", "stride_foot_lift"}
BAT_EVENTS = {"impact_estimate", "swing_launch", "finish", "load_peak_estimate"}
EVENT_ANCHORS = {
    "swing_launch": {"impact_estimate"}, "finish": {"impact_estimate"},
    "extension": {"impact_estimate"}, "stance_set": {"swing_launch"},
    "load_peak_estimate": {"swing_launch"},
    "stride_foot_lift": {"swing_launch", "impact_estimate"},
    "foot_plant": {"swing_launch", "impact_estimate", "stride_foot_lift"},
}


def limit(name):
    return Fraction(str(T[name]))


def empty(event_id, reason, status="unavailable"):
    return {"id": event_id, "version": "v2-event-1.0.0", "status": status,
            "frame": None, "pts": None, "time_s": None, "window_s": None,
            "basis": "v2:" + event_id, "support": {}, "observation": None, "reason_codes": [reason],
            "downstream_use": None}


def located(event_id, row, bracket=None, observation="direct", **support):
    bounds = bracket or (row, row)
    return {**empty(event_id, ""), "status": "available", "frame": row["index"],
            "pts": row["pts"], "time_s": row["time_s"],
            "window_s": [bounds[0]["time_s"], bounds[1]["time_s"]],
            "support": support, "observation": observation, "reason_codes": []}


def enforce_order(events):
    # Evaluate all edges before invalidating: a conflict must not disappear merely
    # because another edge invalidated its predecessor first.
    # Auxiliary pose timing cannot invalidate a bat-derived launch anchor. Stance and load
    # conflicting with each other are both distrusted (the latest still window may be the
    # loaded pause). A stride lift at or after launch is a heel pivot, not a stride.
    reasons = {}
    for a, b in ORDER:
        if not (events[a]["status"] == events[b]["status"] == "available" and events[a]["time_s"] >= events[b]["time_s"]):
            continue
        if (a, b) == ("stance_set", "load_peak_estimate"):
            reasons.update({a: "EVENT_ORDER_CONFLICT", b: "EVENT_ORDER_CONFLICT"})
        elif (a, b) == ("stride_foot_lift", "swing_launch"):
            reasons[a] = "STRIDE_LIFT_NOT_BEFORE_LAUNCH"
        elif a in ("stance_set", "load_peak_estimate") and b == "swing_launch":
            reasons[a] = "EVENT_ORDER_CONFLICT"
        else:
            reasons[b] = "EVENT_ORDER_CONFLICT"
    for event_id, reason in reasons.items():
        events[event_id] = empty(event_id, reason)
    invalid = set(reasons)
    while True:
        dependents = {e for e, anchors in EVENT_ANCHORS.items() if e not in invalid and anchors & invalid}
        if not dependents:
            break
        for e in dependents:
            events[e] = empty(e, "DEPENDS_ON_UNAVAILABLE_EVENT")
        invalid.update(dependents)


def phase_entries(events):
    return {phase: ({"frame": events[e]["frame"], "time_s": events[e]["time_s"],
                     "method": "v2:" + e, "window_s": events[e]["window_s"], "reason": None}
                    if events[e]["status"] == "available" else
                    {"frame": None, "time_s": None, "reason": events[e]["reason_codes"][0]})
            for phase, e in PHASE_EVENTS.items()}


def connected(a, b):
    return b["index"] == a["index"] + 1 and 0 < b["t"] - a["t"] <= limit("max_derivative_gap_s")


def midpoint(points, ids, confidence):
    if not all(points[i][2] >= confidence for i in ids):
        return None
    return [sum(points[i][axis] for i in ids) / len(ids) for axis in (0, 1)]


def signals(frames, batter_rows, bat_rows):
    bats = {b["frame"]: b for b in bat_rows}
    rows = []
    for frame in frames:
        p, b = batter_rows.get(frame["index"]), bats.get(frame["index"], {})
        row = {**frame, "t": frame["pts"] * Fraction(*frame["time_base"]),
               "height": None, "hands": None, "shoulders": None, "ankles": None,
               "tip": None, "direction": None, "track": None, "speed": None,
               "angular_speed": None, "rotation": None, "hand_speed": None, "ankle_speeds": None}
        if p and (height := p["box_xyxy"][3] - p["box_xyxy"][1]) > 0:
            points = p["keypoints17"]
            row.update(height=height, hands=midpoint(points, (9, 10), PROVISIONAL_THRESHOLDS["keypoint_conf"]),
                       shoulders=midpoint(points, (5, 6), PROVISIONAL_THRESHOLDS["keypoint_conf"]))
            if all(points[i][2] >= T["ankle_conf"] for i in (15, 16)):
                row["ankles"] = [points[i][:2] for i in (15, 16)]
            if b.get("status") == "detected" and b.get("tip") is not None:
                row.update(tip=b["tip"], track=b["track_id"])
                if row["hands"] is not None and b.get("angle_deg") is not None:
                    angle = b["angle_deg"]
                    projection = sum((b["tip"][j] - row["hands"][j]) * v
                                     for j, v in enumerate((cos(radians(angle)), sin(radians(angle)))))
                    if abs(projection) > 1e-9:
                        row["direction"] = (angle + (180 if projection < 0 else 0)) % 360
        if rows and connected(rows[-1], row) and row["height"]:
            previous = rows[-1]
            dt = float(row["t"] - previous["t"])
            scale = dt * row["height"]
            if row["hands"] is not None and previous["hands"] is not None:
                row["hand_speed"] = dist(row["hands"], previous["hands"]) / scale
            if row["ankles"] is not None and previous["ankles"] is not None:
                row["ankle_speeds"] = [dist(a, b) / scale for a, b in zip(row["ankles"], previous["ankles"])]
            if row["tip"] is not None and previous["tip"] is not None and row["track"] == previous["track"]:
                row["speed"] = dist(row["tip"], previous["tip"]) / scale
                if row["direction"] is not None and previous["direction"] is not None:
                    turn = (row["direction"] - previous["direction"] + 180) % 360 - 180
                    row["angular_speed"] = turn / dt
                    row["rotation"] = (previous["rotation"] if previous["rotation"] is not None
                                       else previous["direction"]) + turn
        if row["rotation"] is None and row["direction"] is not None:
            row["rotation"] = row["direction"]
        rows.append(row)
    return rows


def pose_events(rows, launch_index, impact_index, events):
    launch, impact = rows[launch_index], rows[impact_index]
    before = rows[launch_index - 1]
    displacement = [launch["tip"][j] - before["tip"][j] for j in (0, 1)]
    length = hypot(*displacement)
    hands = [r for r in rows if launch["t"] - limit("load_search_s") <= r["t"] < launch["t"]
             and r["hands"] is not None]
    if hands and length:
        unit = [v / length for v in displacement]
        row = min(hands, key=lambda r: sum(r["hands"][j] * unit[j] for j in (0, 1)))
        if row is hands[0] or row is hands[-1]:
            events["load_peak_estimate"] = empty("load_peak_estimate", "LOAD_PEAK_AT_WINDOW_EDGE")
        else:
            events["load_peak_estimate"] = located("load_peak_estimate", row, observation="pose",
                                                  observations=len(hands), launch_direction=unit)
    else:
        events["load_peak_estimate"] = empty("load_peak_estimate", "HANDS_NOT_VISIBLE")

    window = [r for r in rows if launch["t"] - limit("stance_search_s") <= r["t"] < launch["t"]]
    start, previous, count = None, None, 0
    for r in window:
        still = (previous is not None and connected(previous, r) and r["hand_speed"] is not None
                 and r["ankle_speeds"] is not None
                 and max(r["hand_speed"], *r["ankle_speeds"]) < T["stance_still_h_per_s"])
        if still:
            if start is None:
                start, count = previous, 1
            count += 1
            if r["t"] - start["t"] >= limit("stance_min_s"):
                events["stance_set"] = located("stance_set", start, (start, r), "pose", observations=count)
        else:
            start, count = None, 0
        previous = r

    window = [r for r in rows if launch["t"] - limit("stride_search_s") <= r["t"] <= impact["t"]]
    # No assertion of no stride from occluded feet, a missing frame, or a missing
    # baseline. The baseline is the first observed search-window interval.
    if (not window or any(r["ankles"] is None for r in window)
            or any(not connected(a, b) for a, b in zip(window, window[1:]))
            or window[-1]["t"] - window[0]["t"] < limit("stance_min_s")):
        for e in ("stride_foot_lift", "foot_plant"):
            events[e] = empty(e, "ANKLES_NOT_VISIBLE")
        return
    baseline = [r for r in window if r["t"] < window[0]["t"] + limit("stance_min_s")]
    levels = [median(r["ankles"][j][1] for r in baseline) for j in (0, 1)]
    excursion = lambda r, j: (levels[j] - r["ankles"][j][1]) / r["height"]
    lead = max((0, 1), key=lambda j: max(excursion(r, j) for r in window))
    lift = next((r for r in window if excursion(r, lead) > T["foot_lift_h"]), None)
    if lift is None:
        for e in ("stride_foot_lift", "foot_plant"):
            events[e] = empty(e, "NO_STRIDE_DETECTED", "not_applicable")
        return
    support = {"ankle_index": 15 + lead, "baseline_observations": len(baseline), "baseline_y": levels[lead]}
    events["stride_foot_lift"] = located("stride_foot_lift", lift, observation="pose",
                                         excursion_h=excursion(lift, lead), **support)
    plant = next((r for r in window if r["t"] > lift["t"] and excursion(r, lead) < T["foot_plant_h"]
                  and r["ankle_speeds"] is not None
                  and r["ankle_speeds"][lead] < T["foot_plant_still_h_per_s"]), None)
    events["foot_plant"] = (located("foot_plant", plant, observation="pose",
                                   speed_h_per_s=plant["ankle_speeds"][lead], **support) if plant
                            else empty("foot_plant", "FOOT_PLANT_NOT_OBSERVED"))


def detect_events(frames, batter_rows, bat_rows, grounding, raster_size):
    """Return metrics additions and a local timeline; raster_size = (width, height)."""
    rows = signals(frames, batter_rows, bat_rows)
    events = {e: empty(e, "INSUFFICIENT_OBSERVATIONS") for e in EVENT_IDS}
    for e in ("contact_confirmed", "load_start"):
        events[e] = empty(e, "NOT_PRODUCED")
    heights = [r["height"] for r in rows if r["height"]]
    by_index = {r["index"]: r for r in rows}
    lengths = [b["length_px"] / by_index[b["frame"]]["height"] for b in bat_rows
               if b["status"] == "detected" and b["frame"] in by_index
               and by_index[b["frame"]]["height"] and b.get("length_px") is not None]
    size = median(heights) / raster_size[1] if heights and raster_size[1] else None
    short = sum(v < T["min_bat_length_h"] for v in lengths) / len(lengths) if lengths else None
    camera = (["SMALL_BATTER"] if size is not None and size < T["min_batter_box_fraction"] else [])
    if short is not None and short > T["foreshortened_fraction"]:
        camera.append("BAT_HEAVILY_FORESHORTENED")
    conflict = "POSE_BAT_DISAGREEMENT" in grounding.get("reason_codes", [])
    diagnostics = {"possible_batter_selection_conflict": conflict, "batter_box_fraction": size,
                   "foreshortened_fraction": short, "direct_bat_observations": len(lengths), "reason_codes": camera}
    detection = {"status": "not_evaluated", "confidence": None}
    selected = grounding.get("status") == "selected" and bool(batter_rows)
    samples = [i for i, r in enumerate(rows) if r["speed"] is not None]
    peak_index, rejected = None, []
    if selected and samples:
        for i in sorted(samples, key=lambda i: -rows[i]["speed"]):
            candidate = rows[i]
            # Stationary samples are not peaks; do not let a flat interval turn
            # an unsupported moving spike into a claim of no swing candidate.
            if candidate["speed"] == 0:
                continue
            neighbours = [rows[j] for j in (i-1, i+1) if 0 <= j < len(rows)]
            supported = (len(neighbours) == 2 and all(r["speed"] is not None for r in neighbours)
                         and all(r["track"] == candidate["track"] for r in neighbours)
                         and connected(neighbours[0], candidate) and connected(candidate, neighbours[1])
                         and all(r["speed"] >= T["peak_support_fraction"] * candidate["speed"] for r in neighbours))
            if supported:
                peak_index = i
                break
            rejected.append(candidate["speed"])
    if selected and peak_index is not None:
        peak = rows[peak_index]
        peak_speed = peak["speed"]
        # Rotation support belongs to one continuous direct run around this peak.
        left = right = peak_index
        while left > 0 and rows[left]["angular_speed"] is not None and peak["t"] - rows[left-1]["t"] <= limit("rotation_window_s"):
            left -= 1
        while right + 1 < len(rows) and rows[right+1]["angular_speed"] is not None and rows[right+1]["t"] - peak["t"] <= limit("rotation_window_s"):
            right += 1
        rotations = [r["rotation"] for r in rows[left:right+1] if r["rotation"] is not None]
        rotation = max(rotations) - min(rotations) if rotations else None
        neighbours = [rows[i] for i in (peak_index-1, peak_index+1) if 0 <= i < len(rows)]
        no_candidate = peak_speed < T["min_swing_peak_speed_h_per_s"]
        if not no_candidate and rotation is None:
            events["impact_estimate"] = empty("impact_estimate", "INSUFFICIENT_ROTATION_EVIDENCE")
        elif no_candidate or rotation < T["min_swing_rotation_deg"]:
            detection = {"status": "no_swing_candidate", "confidence": "low"}
            for e in EVENT_IDS:
                if e not in ("stance_set", "contact_confirmed", "load_start"):
                    events[e] = empty(e, "NO_SWING_CANDIDATE", "not_applicable")
        else:
            events["impact_estimate"] = located("impact_estimate", peak, tuple(neighbours),
                peak_speed_h_per_s=peak_speed, rotation_deg=rotation, rotation_observations=len(rotations),
                neighbouring_speeds_h_per_s=[r["speed"] for r in neighbours], derivative_observations=3)
            events["swing_launch"] = empty("swing_launch", "INSUFFICIENT_BAT_COVERAGE_BEFORE_IMPACT")
            launch_index = None
            for i in range(peak_index - 1, 0, -1):
                if rows[i]["speed"] is None or not connected(rows[i], rows[i+1]) or rows[i]["track"] != peak["track"]:
                    break
                if rows[i]["speed"] < T["launch_speed_fraction"] * peak_speed:
                    launch_index = i + 1
                    events["swing_launch"] = located("swing_launch", rows[i+1], (rows[i], rows[i+1]),
                        threshold_h_per_s=T["launch_speed_fraction"] * peak_speed, observations=peak_index-i+1)
                    break
            events["finish"] = empty("finish", "CLIP_ENDS_BEFORE_FINISH")
            start = None
            for i in range(peak_index + 1, len(rows)):
                r = rows[i]
                if r["speed"] is None or not connected(rows[i-1], r) or r["track"] != peak["track"]:
                    events["finish"] = empty("finish", "INSUFFICIENT_BAT_COVERAGE_AFTER_IMPACT")
                    break
                if r["speed"] < T["finish_speed_fraction"] * peak_speed:
                    if start is None:
                        start = i
                    if r["t"] - rows[start]["t"] >= limit("finish_sustain_s"):
                        events["finish"] = located("finish", rows[start], (rows[start], r),
                            observations=i-start+1, sustain_s=float(r["t"]-rows[start]["t"]))
                        break
                else:
                    start = None
            extension = [r for r in rows if peak["t"] < r["t"] <= peak["t"] + limit("extension_search_s")
                         and r["hands"] is not None and r["shoulders"] is not None]
            if extension:
                distance = lambda r: dist(r["hands"], r["shoulders"]) / r["height"]
                r = max(extension, key=distance)
                events["extension"] = located("extension", r, observation="pose", observations=len(extension), distance_h=distance(r))
            else:
                events["extension"] = empty("extension", "WRISTS_OR_SHOULDERS_NOT_VISIBLE")
            if launch_index is not None:
                pose_events(rows, launch_index, peak_index, events)
            else:
                for e in ("stance_set", "load_peak_estimate", "stride_foot_lift", "foot_plant"):
                    events[e] = empty(e, "SWING_LAUNCH_UNAVAILABLE")
    elif selected and samples:
        if max(rows[i]["speed"] for i in samples) >= T["min_swing_peak_speed_h_per_s"]:
            events["impact_estimate"] = empty("impact_estimate", "INSUFFICIENT_PEAK_SUPPORT")
        else:
            detection = {"status": "no_swing_candidate", "confidence": "low"}
            for e in EVENT_IDS:
                if e not in ("stance_set", "contact_confirmed", "load_start"):
                    events[e] = empty(e, "NO_SWING_CANDIDATE", "not_applicable")
    elif selected:
        events["impact_estimate"] = empty("impact_estimate", "BAT_MISSING_NEAR_IMPACT")

    if selected and samples:
        events["impact_estimate"]["support"].update(
            rejected_spikes=len(rejected), max_rejected_spike_h_per_s=max(rejected) if rejected else None)
    enforce_order(events)
    if not selected:
        events = {e: empty(e, "NO_SELECTED_BATTER") for e in EVENT_IDS}
    else:
        gate = ("IDENTITY_NOT_BAT_GROUNDED" if grounding.get("basis") == "pose_only" else
                "UNSUPPORTED_CAMERA_GEOMETRY" if camera else None)
        if gate:
            for e in BAT_EVENTS | set(EVENT_ANCHORS):
                events[e] = empty(e, gate)
            detection = {"status": "not_evaluated", "confidence": None}
        for e in events.values():
            if e["status"] == "available":
                if conflict:
                    e["reason_codes"].append("POSSIBLE_BATTER_CONFLICT")
    if events["impact_estimate"]["status"] == "available":
        detection = {"status": "swing_candidate", "confidence": "low"}
    for e in events.values():
        e["downstream_use"] = (None if e["status"] != "available"
                               else "not_recommended" if e["id"] in NOT_RECOMMENDED else "experimental")
    timeline = [{"frame": r["index"], "pts": r["pts"], "time_s": r["time_s"],
                 "barrel_speed_h_per_s": r["speed"], "angular_speed_deg_per_s": r["angular_speed"],
                 "direct_bat": r["tip"] is not None, "direct_pose": r["height"] is not None,
                 "events": [e["id"] for e in events.values() if e["status"] == "available" and e["frame"] == r["index"]]}
                for r in rows]
    return {"events": list(events.values()), "events_schema": "hitterloop.engine-v2.events",
            "events_schema_version": "1.0.0", "phases": phase_entries(events),
            "swing_detection": detection, "diagnostics": diagnostics}, timeline
