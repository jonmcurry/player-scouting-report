"""Dependency-free structural and cross-artifact v2 (M1 + M2) contract validation."""
from math import isfinite
from scripts.engine_v2.identity import (IDENTITY, KEYPOINT_NAMES, THRESHOLDS_SHA256,
                                       BAT_THRESHOLDS_SHA256, SELECTION_THRESHOLDS_SHA256, EVENT_THRESHOLDS_SHA256)
from scripts.engine_v2.events import EVENT_IDS, NOT_RECOMMENDED, ORDER, phase_entries
from scripts.engine_v2.bat_track import STATUSES
from scripts.engine_v2.run_engine import PHASES


def validate(artifacts):
    required = {"frame_map.json", "pose_2d.json", "bat_path.json", "metrics.json", "tracks.json", "engine_manifest.json", "pipeline_status.json", "events_timeline.json"}
    assert set(artifacts) == required
    for name, artifact in artifacts.items():
        identity = artifact["meta"] if name in ("pose_2d.json", "bat_path.json") else artifact
        assert all(identity.get(k) == v for k, v in IDENTITY.items()), name
    fmap = artifacts["frame_map.json"]
    pose = artifacts["pose_2d.json"]
    metrics = artifacts["metrics.json"]
    assert fmap["schema"] == "hitterloop.engine-v2.frame-map"
    assert fmap["schema_version"] == "1.0.0"
    assert len(fmap["frames"]) == pose["meta"]["n_frames"] == len(pose["frames"])
    assert pose["meta"]["keypoint_names"] == KEYPOINT_NAMES
    assert "bat_evidence" not in pose["meta"]
    assert pose["meta"]["smoothing"] == "none"
    assert all(k in pose["meta"] for k in ("video", "fps", "width", "height", "time_base", "vfr", "batter_selection"))
    for i, (source, target) in enumerate(zip(fmap["frames"], pose["frames"])):
        assert source["index"] == target["frame"] == i
        assert source["pts"] == target["pts"] and isinstance(source["pts"], int)
        assert source["time_s"] == target["time_s"]
        assert source["mapping"] == "direct_decode"
        assert len(source["time_base"]) == 2 and source["time_base"][1] > 0
        points = target["keypoints"]
        assert points is None or (len(points) == 17 and all(len(p) == 3 for p in points))
        if points is not None:
            assert all(isfinite(v) for p in points for v in p)
    assert set(metrics["phases"]) == set(PHASES)
    validate_events(metrics, fmap)
    manifest = artifacts["engine_manifest.json"]
    assert manifest["event_thresholds_sha256"] == metrics["event_thresholds_sha256"] == EVENT_THRESHOLDS_SHA256
    timeline = artifacts["events_timeline.json"]["frames"]
    assert len(timeline) == len(fmap["frames"])
    for row, frame in zip(timeline, fmap["frames"]):
        assert (row["frame"], row["pts"], row["time_s"]) == (frame["index"], frame["pts"], frame["time_s"])
        assert all(row[k] is None or isfinite(row[k]) for k in ("barrel_speed_h_per_s", "angular_speed_deg_per_s"))
        assert row["events"] == [e["id"] for e in metrics["events"] if e["status"] == "available" and e["frame"] == row["frame"]]
    assert manifest["thresholds_sha256"] == artifacts["tracks.json"]["thresholds_sha256"] == THRESHOLDS_SHA256
    assert manifest["input_sha256"] == fmap["input_sha256"] and len(fmap["input_sha256"]) == 64
    assert len(manifest["tracker_sha256"]) == 64
    assert all(isfinite(t) and t >= 0 for t in manifest["wall_times_s"].values())
    assert set(manifest["versions"]) == {"python", "torch", "ultralytics", "av", "ffmpeg"}
    tracks = artifacts["tracks.json"]
    assert all(isinstance(tracks[k], list) for k in ("tracks", "segments", "continuity_events", "candidates"))
    assert tracks["batter"] == metrics["batter"] == pose["meta"]["batter_selection"]
    validate_grounding(tracks, manifest, fmap, pose)
    assert artifacts["pipeline_status.json"]["status"] in ("complete", "analysis_unavailable", "crashed")
    validate_bat(artifacts["bat_path.json"], fmap, pose)


def validate_events(metrics, fmap):
    assert metrics["events_schema"] == "hitterloop.engine-v2.events"
    assert metrics["events_schema_version"] == "1.0.0"
    assert [e["id"] for e in metrics["events"]] == list(EVENT_IDS)
    events = {e["id"]: e for e in metrics["events"]}
    frames = {f["index"]: f for f in fmap["frames"]}
    for e in events.values():
        assert e["version"] == "v2-event-1.0.0"
        assert e["status"] in ("available", "unavailable", "not_applicable")
        assert e["basis"] == "v2:" + e["id"]
        assert isinstance(e["support"], dict)
        assert isinstance(e["reason_codes"], list) and all(isinstance(r, str) and r for r in e["reason_codes"])
        if e["status"] == "available":
            assert type(e["frame"]) is int and e["frame"] in frames
            f = frames[e["frame"]]
            assert type(e["pts"]) is int and e["pts"] == f["pts"] and e["time_s"] == f["time_s"]
            assert e["observation"] in ("direct", "pose")
            assert isinstance(e["window_s"], list) and len(e["window_s"]) == 2
            lo, hi = e["window_s"]
            assert isfinite(lo) and isfinite(hi) and lo <= e["time_s"] <= hi
            assert fmap["frames"][0]["time_s"] <= lo <= hi <= fmap["frames"][-1]["time_s"]
        else:
            assert all(e[k] is None for k in ("frame", "pts", "time_s", "window_s", "observation"))
            assert e["reason_codes"]
        expected_use = (None if e["status"] != "available"
                        else "not_recommended" if e["id"] in NOT_RECOMMENDED else "experimental")
        assert e["downstream_use"] == expected_use
    for a, b in ORDER:
        if events[a]["status"] == events[b]["status"] == "available":
            assert events[a]["time_s"] < events[b]["time_s"]
    for e in ("contact_confirmed", "load_start"):
        assert events[e]["status"] == "unavailable"
        assert events[e]["reason_codes"] in (["NOT_PRODUCED"], ["NO_SELECTED_BATTER"])
    assert metrics["phases"] == phase_entries(events)
    detection = metrics["swing_detection"]
    assert detection in ({"status": "not_evaluated", "confidence": None},
                         {"status": "no_swing_candidate", "confidence": "low"},
                         {"status": "swing_candidate", "confidence": "low"})
    assert (detection["status"] == "swing_candidate") == (events["impact_estimate"]["status"] == "available")


def validate_grounding(tracks, manifest, fmap, pose):
    grounding = tracks["grounding"]
    assert set(grounding) == {"thresholds_sha256", "evidence", "pose_decision", "final_decision"}
    assert grounding["thresholds_sha256"] == manifest["selection_thresholds_sha256"] == SELECTION_THRESHOLDS_SHA256
    eligible = {c["segment_id"] for c in tracks["candidates"] if c["eligible"]}
    segments = {s["id"]: s for s in tracks["segments"]}
    assert grounding["final_decision"] == tracks["batter"]
    for decision in (grounding["pose_decision"], grounding["final_decision"]):
        assert decision["status"] in ("selected", "ambiguous", "unavailable")
        assert isinstance(decision["reason_codes"], list) and all(isinstance(r, str) for r in decision["reason_codes"])
        if decision["status"] == "selected":
            assert decision["segment_id"] in eligible
        else:
            assert decision["segment_id"] is None
    final = grounding["final_decision"]
    if eligible:
        assert final["basis"] in ("pose_only", "pose_and_bat")
    else:
        assert final == grounding["pose_decision"] and final["status"] == "unavailable"
    evidence = grounding["evidence"]
    assert isinstance(evidence, list)
    assert len(evidence) == len(eligible) and {e["segment_id"] for e in evidence} == eligible
    for e in evidence:
        assert set(e) == {"segment_id", "segment_frames", "detected", "exclusive", "shared",
                          "exclusive_fraction", "exclusive_span_s"}
        assert all(type(e[k]) is int and e[k] >= 0 for k in ("segment_frames", "detected", "exclusive", "shared"))
        assert e["segment_frames"] == len(segments[e["segment_id"]]["rows"])
        assert e["exclusive"] + e["shared"] == e["detected"] <= e["segment_frames"] <= len(fmap["frames"])
        expected = e["exclusive"] / len(fmap["frames"]) if fmap["frames"] else 0
        assert e["exclusive_fraction"] == expected
        assert isfinite(e["exclusive_span_s"]) and e["exclusive_span_s"] >= 0
        if e["exclusive"] < 2:
            assert e["exclusive_span_s"] == 0
    selected = segments[final["segment_id"]] if final["status"] == "selected" else None
    indices = {r["index"] for r in selected["rows"]} if selected else set()
    assert all((r["keypoints"] is not None) == (r["frame"] in indices) for r in pose["frames"])


def point(value):
    return isinstance(value, list) and len(value) == 2 and all(isinstance(v, (int, float)) and isfinite(v) for v in value)


def validate_bat(bat, fmap, pose):
    meta = bat["meta"]
    for key in ("fps", "width", "height", "n_frames", "time_base", "rotation", "vfr"):
        assert meta[key] == pose["meta"][key], key
    assert meta["bat_status"] in ("observed", "not_detected", "not_evaluated", "unavailable")
    assert meta["thresholds_sha256"] == BAT_THRESHOLDS_SHA256
    assert meta["score_semantics"] == "uncalibrated_model_score"
    assert meta["endpoint_names"] == {"knob": "knob", "tip": "barrel_end"}
    assert len(bat["frames"]) == len(fmap["frames"]) == meta["n_frames"]
    counts = {s: 0 for s in STATUSES}
    for source, row in zip(fmap["frames"], bat["frames"]):
        assert (row["frame"], row["pts"], row["time_s"]) == (source["index"], source["pts"], source["time_s"])
        assert row["status"] in STATUSES
        counts[row["status"]] += 1
        if row["status"] == "detected":
            assert point(row["tip"]) and point(row["knob"]) and isinstance(row["conf"], float)
            assert isinstance(row["track_id"], int) and row["knob_source"] in ("hands", "temporal_continuity")
            assert row["interpolated"] is None and len(row["endpoints"]) == 2
        else:
            # Only a direct, identity-resolved detection may fill the baseline-compatible fields.
            assert row["tip"] is None and row["knob"] is None and row["conf"] is None
        if row["status"] == "interpolated":
            assert point(row["interpolated"]["tip"]) and point(row["interpolated"]["knob"]) and row["endpoints"] is None
            assert "INTERPOLATED_SHORT_GAP" in row["reason_codes"]
        else:
            assert row["interpolated"] is None
        if row["status"] == "ambiguous_candidate":
            assert all(row[k] is None for k in ("endpoints", "track_id", "length_px", "width_px",
                                                "angle_deg", "elongation", "fragmented"))
        if row["status"] == "ambiguous_orientation":
            assert len(row["endpoints"]) == 2 and all(point(p) for p in row["endpoints"]) and row["track_id"] is None
    assert meta["summary"]["counts"] == counts
    assert (meta["bat_status"] == "observed") == (counts["detected"] > 0) or meta["bat_status"] in ("unavailable", "not_evaluated")
