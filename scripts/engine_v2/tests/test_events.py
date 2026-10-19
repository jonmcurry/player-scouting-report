"""M3 synthetic trajectories only. No real footage or annotation files."""
from copy import deepcopy
from fractions import Fraction
import hashlib
import json
from math import cos, radians, sin
from pathlib import Path
import shutil
import tempfile
import unittest
import uuid
from unittest.mock import patch

import numpy as np
from scripts.engine_v2.events import detect_events, signals, enforce_order, pose_events, EVENT_IDS, ORDER
from scripts.engine_v2.identity import PROVISIONAL_EVENT_THRESHOLDS as T, EVENT_THRESHOLDS_SHA256
from scripts.engine_v2.run_engine import run
from scripts.engine_v2.schema import validate, validate_events
from scripts.engine_v2.tests.test_engine import fixture, NoBat
from scripts.engine_v2.tracking import PersonDetection
from scripts.engine_v2.overlay_events import destination_path, overlay
from scripts.engine_v2.decode import decode


def trajectory():
    frames, poses, bats = [], {}, []
    angle = 0
    for i in range(40):
        f = {"index": i, "pts": i * 50 - 200, "time_base": [1, 1000],
             "time_s": (i * 50 - 200) / 1000, "mapping": "direct_decode", "key_frame": False}
        frames.append(f)
        angle += {20: 2, 21: 5, 22: 15, 23: 35, 24: 45, 25: 35, 26: 20, 27: 5}.get(i, 0)
        hand = [205, 140] if i == 20 else [220, 160] if i == 27 else [200, 150]
        points = [[200, 150, .99] for _ in range(17)]
        points[5], points[6] = [180, 100, .99], [220, 100, .99]
        points[9], points[10] = [hand[0]-2, hand[1], .99], [hand[0]+2, hand[1], .99]
        points[11], points[12] = [185, 200, .99], [215, 200, .99]
        lift = 12 if 15 <= i <= 17 else 6 if i == 18 else 0
        points[15], points[16] = [180, 280-lift, .99], [220, 280, .99]
        poses[i] = {**f, "keypoints17": points, "box_xyxy": [150, 80, 250, 280],
                    "box_conf": .99, "track_id": 1, "display_height": 320}
        bats.append({"frame": i, "pts": f["pts"], "time_s": f["time_s"], "status": "detected",
                     "track_id": 1, "tip": [200+100*cos(radians(angle)), 150+100*sin(radians(angle))],
                     "knob": [200, 150], "angle_deg": angle % 180, "length_px": 100})
    return frames, poses, bats, {"status": "selected", "segment_id": "1:0", "basis": "pose_and_bat", "reason_codes": []}, (400, 320)


def evaluate(inputs):
    metrics, timeline = detect_events(*inputs)
    validate_events(metrics, {"frames": inputs[0]})
    return metrics, {e["id"]: e for e in metrics["events"]}, timeline


class EventTests(unittest.TestCase):
    def test_complete_swing_order_windows_and_support(self):
        inputs = trajectory()
        metrics, events, timeline = evaluate(inputs)
        self.assertEqual(metrics["swing_detection"], {"status": "swing_candidate", "confidence": "low"})
        for e in EVENT_IDS:
            self.assertEqual(events[e]["status"], "unavailable" if e in ("contact_confirmed", "load_start") else "available", e)
        self.assertEqual(events["impact_estimate"]["frame"], 24)
        self.assertEqual(events["impact_estimate"]["window_s"], [.95, 1.05])
        self.assertEqual(events["swing_launch"]["frame"], 22)
        self.assertEqual(events["load_peak_estimate"]["frame"], 20)
        self.assertEqual(events["stride_foot_lift"]["frame"], 15)
        self.assertEqual(events["foot_plant"]["frame"], 20)
        self.assertEqual(events["finish"]["frame"], 27)
        self.assertEqual(events["extension"]["frame"], 27)
        self.assertEqual(events["stance_set"]["frame"], 0)
        for a, b in ORDER:
            self.assertLess(events[a]["time_s"], events[b]["time_s"])
        self.assertIn("impact_estimate", timeline[24]["events"])
        self.assertEqual(events["impact_estimate"]["support"]["derivative_observations"], 3)

    def test_take_and_partial_swing(self):
        for mode in ("take", "partial"):
            inputs = trajectory()
            for i, b in enumerate(inputs[2]):
                angle = 0 if mode == "take" else min(i, 10)
                b.update(angle_deg=angle % 180, tip=[200+100*cos(radians(angle)), 150+100*sin(radians(angle))])
            metrics, events, _ = evaluate(inputs)
            self.assertEqual(metrics["swing_detection"]["status"], "no_swing_candidate", mode)
            for e in EVENT_IDS:
                if e not in ("stance_set", "contact_confirmed", "load_start"):
                    self.assertEqual(events[e]["reason_codes"], ["NO_SWING_CANDIDATE"])
                    self.assertEqual(events[e]["status"], "not_applicable")

    def test_supported_swing_survives_higher_single_sample_spike(self):
        inputs = trajectory()
        # One displaced tip creates two unsupported derivative spikes before
        # the real swing, each with a stationary neighbour on its other side.
        inputs[2][8]["tip"] = [900, 150]
        metrics, events, timeline = evaluate(inputs)
        impact = events["impact_estimate"]
        self.assertEqual(impact["frame"], 24)
        self.assertEqual(metrics["swing_detection"]["status"], "swing_candidate")
        self.assertEqual(impact["support"]["rejected_spikes"], 2)
        self.assertEqual(impact["support"]["max_rejected_spike_h_per_s"], 60)
        self.assertGreater(timeline[8]["barrel_speed_h_per_s"], timeline[24]["barrel_speed_h_per_s"])

    def test_only_unsupported_spike_is_unavailable_not_no_swing(self):
        inputs = trajectory()
        for i, b in enumerate(inputs[2]):
            b.update(angle_deg=0, tip=[900 if i == 8 else 300, 150])
        metrics, events, _ = evaluate(inputs)
        impact = events["impact_estimate"]
        self.assertEqual(impact["status"], "unavailable")
        self.assertEqual(impact["reason_codes"], ["INSUFFICIENT_PEAK_SUPPORT"])
        self.assertEqual(impact["support"]["rejected_spikes"], 2)
        self.assertEqual(impact["support"]["max_rejected_spike_h_per_s"], 60)
        self.assertEqual(metrics["swing_detection"], {"status": "not_evaluated", "confidence": None})

    def test_pts_derivatives_cfr_vfr_and_rounding(self):
        inputs = trajectory()
        original = signals(*inputs[:3])
        frames = inputs[0]
        # Exact rational PTS, with rounded display time deliberately unchanged.
        for i, f in enumerate(frames):
            f.update(pts=i*50 + (25 if i >= 24 else 0), time_base=[1, 1000])
        changed = signals(*inputs[:3])
        self.assertAlmostEqual(changed[24]["speed"], original[24]["speed"] * 2/3)
        self.assertAlmostEqual(changed[24]["angular_speed"], original[24]["angular_speed"] * 2/3)
        self.assertAlmostEqual(changed[25]["speed"], original[25]["speed"])
        for i, f in enumerate(frames):
            f.update(pts=i, time_base=[1, 30], time_s=round(i/30, 6))
        exact = signals(*inputs[:3])
        self.assertAlmostEqual(exact[24]["speed"], original[24]["speed"] * 1.5)

    def test_knob_never_used_and_angle_sign_is_axis_invariant(self):
        inputs = trajectory()
        expected = detect_events(*inputs)
        for i, b in enumerate(inputs[2]):
            b["knob"] = [1e9 * (-1)**i, -1e10]
            b["angle_deg"] += 180
        actual = detect_events(*inputs)
        self.assertEqual(actual, expected)

    def test_missing_ambiguous_interpolated_and_missing_frame_near_impact(self):
        for status in ("missing", "interpolated", "ambiguous_orientation", "ambiguous_candidate", "absent_frame"):
            inputs = trajectory()
            if status == "absent_frame":
                inputs[0].pop(25)
            else:
                inputs[2][25].update(status=status, tip=None, interpolated={"tip": [1e6, 1e6]})
            metrics, events, timeline = evaluate(inputs)
            # The old maximum (24) lacks its next neighbour. Sample 23 still
            # has valid direct support on both sides and sufficient rotation.
            self.assertEqual(events["impact_estimate"]["frame"], 23, status)
            self.assertEqual(metrics["swing_detection"]["status"], "swing_candidate")
            self.assertGreater(events["impact_estimate"]["support"]["rejected_spikes"], 0)
            if status != "absent_frame":
                self.assertIsNone(timeline[25]["barrel_speed_h_per_s"])
                self.assertFalse(timeline[25]["direct_bat"])

    def test_identity_and_camera_gates(self):
        for status in ("ambiguous", "unavailable"):
            inputs = trajectory()
            inputs[3].update(status=status, segment_id=None)
            metrics, events, _ = evaluate(inputs)
            self.assertTrue(all(e["reason_codes"] == ["NO_SELECTED_BATTER"] for e in events.values()))
            self.assertEqual(metrics["swing_detection"]["status"], "not_evaluated")
        inputs = trajectory()
        inputs[3]["basis"] = "pose_only"
        metrics, events, _ = evaluate(inputs)
        for e in ("impact_estimate", "swing_launch", "finish", "load_peak_estimate"):
            self.assertEqual(events[e]["reason_codes"], ["IDENTITY_NOT_BAT_GROUNDED"])
        for e in ("stance_set", "stride_foot_lift", "foot_plant", "extension"):
            self.assertEqual(events[e]["status"], "unavailable")
            self.assertEqual(events[e]["reason_codes"], ["IDENTITY_NOT_BAT_GROUNDED"])
            self.assertIsNone(events[e]["frame"])
        self.assertTrue(all(p["frame"] is None for p in metrics["phases"].values()))
        self.assertEqual(metrics["swing_detection"]["status"], "not_evaluated")
        inputs = trajectory()
        inputs[3]["reason_codes"] = ["POSE_BAT_DISAGREEMENT"]
        metrics, events, _ = evaluate(inputs)
        self.assertTrue(metrics["diagnostics"]["possible_batter_selection_conflict"])
        self.assertTrue(all("POSSIBLE_BATTER_CONFLICT" in e["reason_codes"] for e in events.values() if e["status"] == "available"))
        for reason in ("SMALL_BATTER", "BAT_HEAVILY_FORESHORTENED"):
            inputs = list(trajectory())
            if reason == "SMALL_BATTER":
                inputs[4] = (400, 2000)
            else:
                for b in inputs[2]: b["length_px"] = 20
            metrics, events, _ = evaluate(inputs)
            self.assertIn(reason, metrics["diagnostics"]["reason_codes"])
            self.assertEqual(events["impact_estimate"]["reason_codes"], ["UNSUPPORTED_CAMERA_GEOMETRY"])
            for e in ("stance_set", "stride_foot_lift", "foot_plant", "extension"):
                self.assertEqual(events[e]["status"], "unavailable")
                self.assertEqual(events[e]["reason_codes"], ["UNSUPPORTED_CAMERA_GEOMETRY"])
            self.assertTrue(all(p["frame"] is None for p in metrics["phases"].values()))
            self.assertEqual(metrics["swing_detection"]["status"], "not_evaluated")

    def test_order_conflicts_cascade_to_anchored_events_and_outputs(self):
        for invalidated in ("impact_estimate",):
            def conflicting_pose_events(rows, launch_index, impact_index, events):
                pose_events(rows, launch_index, impact_index, events)
                # Force launch at impact to exercise the bat-derived order
                # boundary and its output cascade.
                target = "swing_launch"
                anchor = rows[impact_index]
                events[target].update(frame=anchor["index"], pts=anchor["pts"], time_s=anchor["time_s"],
                                      window_s=[anchor["time_s"], anchor["time_s"]])
            with patch("scripts.engine_v2.events.pose_events", side_effect=conflicting_pose_events):
                metrics, events, timeline = evaluate(trajectory())
            self.assertEqual(events[invalidated]["reason_codes"], ["EVENT_ORDER_CONFLICT"])
            dependents = ["stance_set", "load_peak_estimate", "stride_foot_lift", "foot_plant"]
            if invalidated == "impact_estimate":
                dependents += ["swing_launch", "extension", "finish"]
            for e in dependents:
                self.assertEqual(events[e]["status"], "unavailable", e)
                self.assertEqual(events[e]["reason_codes"], ["DEPENDS_ON_UNAVAILABLE_EVENT"], e)
                self.assertFalse(any(e in row["events"] for row in timeline))
            self.assertIsNone(metrics["phases"]["stance"]["frame"])
            self.assertIsNone(metrics["phases"]["stride"]["frame"])
            self.assertEqual(metrics["swing_detection"]["status"],
                             "not_evaluated" if invalidated == "impact_estimate" else "swing_candidate")

    def test_segment_end_sparse_missing_pose_and_no_bat(self):
        inputs = trajectory()
        for i in range(27, 40): del inputs[1][i]
        _, events, _ = evaluate(inputs)
        self.assertEqual(events["impact_estimate"]["status"], "available")
        self.assertEqual(events["finish"]["reason_codes"], ["INSUFFICIENT_BAT_COVERAGE_AFTER_IMPACT"])
        for mode in ("sparse", "no_bat", "no_person", "empty"):
            inputs = list(trajectory())
            if mode == "sparse":
                for f in inputs[0]:
                    f["pts"] *= 4
                    f["time_s"] *= 4
            elif mode == "no_bat": inputs[2] = []
            elif mode == "no_person": inputs[1] = {}
            else: inputs[:3] = [[], {}, []]
            metrics, events, _ = evaluate(inputs)
            self.assertEqual(metrics["swing_detection"]["status"], "not_evaluated", mode)
            self.assertFalse(any(e["status"] == "available" for e in events.values()))

    def test_load_window_edges_are_unresolved_and_keep_launch(self):
        for edge in ("first", "last"):
            inputs = trajectory()
            # At the right boundary, hands continue rearward through launch:
            # exclude launch itself and reject the last pre-launch extremum.
            positions = {0: [220, 110]} if edge == "first" else {21: [210, 130], 22: [215, 120]}
            for index, (x, y) in positions.items():
                inputs[1][index]["keypoints17"][9] = [x-2, y, .99]
                inputs[1][index]["keypoints17"][10] = [x+2, y, .99]
            metrics, events, timeline = evaluate(inputs)
            self.assertEqual(events["load_peak_estimate"]["status"], "unavailable", edge)
            self.assertEqual(events["load_peak_estimate"]["reason_codes"], ["LOAD_PEAK_AT_WINDOW_EDGE"])
            self.assertIsNone(events["load_peak_estimate"]["frame"])
            self.assertEqual(events["swing_launch"]["frame"], 22)
            self.assertEqual(events["swing_launch"]["status"], "available")
            self.assertEqual(events["stance_set"]["status"], "available")
            self.assertEqual(events["foot_plant"]["status"], "available")
            self.assertEqual(metrics["swing_detection"]["status"], "swing_candidate")
            self.assertEqual(metrics["phases"]["load"]["reason"], "LOAD_PEAK_AT_WINDOW_EDGE")
            self.assertFalse(any("load_peak_estimate" in row["events"] for row in timeline))
        # A more extreme hand position at launch must not compete with a
        # resolved interior pre-launch peak (frame 20 in the original fixture).
        inputs = trajectory()
        inputs[1][22]["keypoints17"][9] = [213, 120, .99]
        inputs[1][22]["keypoints17"][10] = [217, 120, .99]
        _, events, _ = evaluate(inputs)
        self.assertEqual(events["load_peak_estimate"]["frame"], 20)
        self.assertEqual(events["swing_launch"]["frame"], 22)

    def test_pose_launch_conflicts_invalidate_only_pose_event(self):
        for pose_event in ("stance_set", "load_peak_estimate"):
            def conflict(rows, launch_index, impact_index, events):
                pose_events(rows, launch_index, impact_index, events)
                launch = rows[launch_index]
                events[pose_event].update(frame=launch["index"], pts=launch["pts"], time_s=launch["time_s"],
                                          window_s=[launch["time_s"], launch["time_s"]])
            with patch("scripts.engine_v2.events.pose_events", side_effect=conflict):
                metrics, events, timeline = evaluate(trajectory())
            self.assertEqual(events[pose_event]["reason_codes"], ["EVENT_ORDER_CONFLICT"])
            self.assertEqual(events[pose_event]["status"], "unavailable")
            # Stance moved onto launch also lands after load: the stance/load rule distrusts both.
            also = {"load_peak_estimate"} if pose_event == "stance_set" else set()
            for e in EVENT_IDS:
                if e not in (pose_event, "load_start", "contact_confirmed", *also):
                    self.assertEqual(events[e]["status"], "available", e)
            self.assertEqual(events["swing_launch"]["frame"], 22)
            self.assertEqual(metrics["swing_detection"]["status"], "swing_candidate")
            self.assertFalse(any(pose_event in row["events"] for row in timeline))

    def test_stance_after_load_distrusts_both_and_keeps_launch(self):
        def conflict(rows, launch_index, impact_index, events):
            pose_events(rows, launch_index, impact_index, events)
            load = events["load_peak_estimate"]
            events["stance_set"].update(frame=load["frame"], pts=load["pts"], time_s=load["time_s"],
                                        window_s=[load["time_s"], load["time_s"]])
        with patch("scripts.engine_v2.events.pose_events", side_effect=conflict):
            metrics, events, _ = evaluate(trajectory())
        for e in ("stance_set", "load_peak_estimate"):
            self.assertEqual((events[e]["status"], events[e]["reason_codes"]), ("unavailable", ["EVENT_ORDER_CONFLICT"]))
        self.assertEqual(events["swing_launch"]["status"], "available")
        self.assertEqual((metrics["phases"]["stance"]["frame"], metrics["phases"]["load"]["frame"]), (None, None))

    def test_stride_lift_at_or_after_launch_is_not_reported(self):
        def late_lift(rows, launch_index, impact_index, events):
            pose_events(rows, launch_index, impact_index, events)
            launch = rows[launch_index]
            self.assertEqual(events["stride_foot_lift"]["status"], "available")
            events["stride_foot_lift"].update(frame=launch["index"], pts=launch["pts"], time_s=launch["time_s"],
                                              window_s=[launch["time_s"], launch["time_s"]])
        with patch("scripts.engine_v2.events.pose_events", side_effect=late_lift):
            metrics, events, _ = evaluate(trajectory())
        self.assertEqual(events["stride_foot_lift"]["reason_codes"], ["STRIDE_LIFT_NOT_BEFORE_LAUNCH"])
        # The moved lift also follows the plant, so the plant may fail on order or on its invalid lift.
        self.assertEqual(events["foot_plant"]["status"], "unavailable")
        self.assertIn(events["foot_plant"]["reason_codes"][0], ("DEPENDS_ON_UNAVAILABLE_EVENT", "EVENT_ORDER_CONFLICT"))
        self.assertIsNone(metrics["phases"]["stride"]["frame"])
        self.assertEqual(events["swing_launch"]["status"], "available")

    def test_downstream_use_labels(self):
        _, events, _ = evaluate(trajectory())
        for e in events.values():
            if e["status"] != "available":
                self.assertIsNone(e["downstream_use"])
            elif e["id"] in ("swing_launch", "stride_foot_lift"):
                self.assertEqual(e["downstream_use"], "not_recommended")
            else:
                self.assertEqual(e["downstream_use"], "experimental")
        self.assertEqual(events["swing_launch"]["downstream_use"], "not_recommended")

    def test_missing_wrists_shoulders_ankles_and_no_stride(self):
        for ids in ((9,), (5,), (15,), ()):
            inputs = trajectory()
            for p in inputs[1].values():
                for i in ids: p["keypoints17"][i][2] = 0
                if not ids: p["keypoints17"][15][1] = 280
            _, events, _ = evaluate(inputs)
            if ids == (9,):
                self.assertNotEqual(events["impact_estimate"]["status"], "available")
            elif ids == (5,):
                self.assertEqual(events["extension"]["reason_codes"], ["WRISTS_OR_SHOULDERS_NOT_VISIBLE"])
            elif ids == (15,):
                self.assertEqual(events["foot_plant"]["reason_codes"], ["ANKLES_NOT_VISIBLE"])
            else:
                self.assertEqual(events["foot_plant"]["reason_codes"], ["NO_STRIDE_DETECTED"])
                self.assertEqual(events["foot_plant"]["status"], "not_applicable")

    def test_launch_and_finish_coverage(self):
        for mode, event, reason in (("before", "swing_launch", "INSUFFICIENT_BAT_COVERAGE_BEFORE_IMPACT"),
                                    ("after", "finish", "INSUFFICIENT_BAT_COVERAGE_AFTER_IMPACT"),
                                    ("end", "finish", "CLIP_ENDS_BEFORE_FINISH")):
            inputs = list(trajectory())
            if mode == "end": inputs[0] = inputs[0][:29]
            else: inputs[2][21 if mode == "before" else 27]["status"] = "missing"
            _, events, _ = evaluate(inputs)
            self.assertEqual(events[event]["reason_codes"], [reason])

    def test_order_conflicts_fail_closed_and_schema_rejects_tampering(self):
        inputs = trajectory()
        metrics, events, _ = evaluate(inputs)
        events["load_peak_estimate"] = {**events["load_peak_estimate"], "time_s": events["swing_launch"]["time_s"]}
        enforce_order(events)
        self.assertEqual(events["load_peak_estimate"]["reason_codes"], ["EVENT_ORDER_CONFLICT"])
        self.assertEqual(events["swing_launch"]["status"], "available")
        for change in ({"pts": 123456}, {"frame": 2.5}, {"time_s": 0}, {"window_s": [2, 3]}, {"status": "unknown"}):
            broken = deepcopy(metrics)
            next(e for e in broken["events"] if e["id"] == "impact_estimate").update(change)
            with self.assertRaises(AssertionError): validate_events(broken, {"frames": inputs[0]})
        broken = deepcopy(metrics)
        broken["phases"]["contact"]["frame"] = None
        with self.assertRaises(AssertionError): validate_events(broken, {"frames": inputs[0]})

    def test_thresholds_are_fixed_and_hashed(self):
        self.assertEqual(len(T), 21)
        self.assertEqual(EVENT_THRESHOLDS_SHA256, hashlib.sha256(json.dumps(T, sort_keys=True, separators=(",", ":")).encode()).hexdigest())


class EventArtifactsTests(unittest.TestCase):
    def setUp(self):
        # Overlay output must be outside the repo even when the test runner sets
        # TEMP to its repo-local test root. The actual OS temporary parent is used.
        self.directory = Path(tempfile.gettempdir()) / f"m3-{uuid.uuid4().hex}"
        self.directory.mkdir(mode=0o755)
        self.addCleanup(shutil.rmtree, self.directory)

    def test_run_engine_available_events_schema_and_repeatability(self):
        frames, poses, bats, _, _ = trajectory()
        source = self.directory / "synthetic.bin"
        source.write_bytes(b"synthetic decoded observations")
        class Detector:
            def detect(self, raster, index):
                p = poses[index]
                return [PersonDetection(1, p["box_xyxy"], .99, p["keypoints17"])]
        def decoder(video, metadata, max_frames):
            metadata.update(width=400, height=320, raw_width=400, raw_height=320, rotation=0,
                            time_base=[1, 1000], nominal_rate=20)
            yield from ((f, np.zeros((320, 400, 3), np.uint8)) for f in frames)
        # Exercise real continuity, eligibility, grounding and bat association;
        # only mask extraction/inference and decoding are doubles.
        class Segmenter:
            def segment(self, raster, index):
                from types import SimpleNamespace
                return [SimpleNamespace(mask=index, score=.9)]
        def geometry(index):
            b = bats[index]
            return {"ok": True, "endpoints": [[200, 150], b["tip"]], "length_px": 100,
                    "width_px": 5, "angle_deg": b["angle_deg"], "elongation": 20, "fragmented": False}
        outputs = [self.directory / str(i) for i in range(2)]
        for out in outputs:
            with patch("scripts.engine_v2.run_engine.decode", side_effect=decoder), patch("scripts.engine_v2.run_engine.mask_geometry", side_effect=geometry):
                self.assertEqual(run(source, out, Detector(), device="cpu", bat_model=Segmenter(),
                                     clock=lambda: 0, now=lambda: "fixed"), "complete")
            artifacts = {p.name: json.loads(p.read_text()) for p in out.glob("*.json")}
            validate(artifacts)
            self.assertEqual(artifacts["metrics.json"]["swing_detection"]["status"], "swing_candidate")
        self.assertEqual({p.name: p.read_bytes() for p in outputs[0].glob("*.json")},
                         {p.name: p.read_bytes() for p in outputs[1].glob("*.json")})

    def test_overlay_refuses_repo_and_missing_git(self):
        root = Path(__file__).resolve().parents[3]
        for dest in (root / "overlay.mp4", root / "sub" / ".." / "overlay.mp4"):
            with self.assertRaisesRegex(ValueError, "outside"):
                destination_path(dest)
        with patch("scripts.engine_v2.overlay_events.subprocess.check_output", side_effect=FileNotFoundError):
            with self.assertRaisesRegex(ValueError, "git working tree"):
                destination_path(self.directory / "outside.mp4")

    def test_overlay_synthetic_outside_repo(self):
        from scripts.engine_v2.tests.test_engine import Double
        # tempfile.gettempdir is overridden by npm; select the OS temp via the
        # user profile when needed, without ever writing output inside the repo.
        root = Path(__file__).resolve().parents[3]
        temporary = self.directory
        if root in temporary.resolve().parents:
            import os
            temporary = Path(os.environ["LOCALAPPDATA"]) / "Temp" / f"m3-overlay-{uuid.uuid4().hex}" if os.name == "nt" else Path("/tmp") / f"m3-overlay-{uuid.uuid4().hex}"
            temporary.mkdir(mode=0o755)
            self.addCleanup(shutil.rmtree, temporary)
        video = temporary / "synthetic.mp4"
        fixture(video, vfr=True)
        out = temporary / "engine"
        run(video, out, Double(), device="cpu", bat_model=NoBat())
        dest = temporary / "overlay.mp4"
        overlay(video, out, dest)
        expected = [Fraction(f["pts"] * f["time_base"][0], f["time_base"][1]) for f, _ in decode(video, {})]
        actual = [Fraction(f["pts"] * f["time_base"][0], f["time_base"][1]) for f, _ in decode(dest, {})]
        self.assertEqual(actual, expected)


if __name__ == "__main__": unittest.main()
