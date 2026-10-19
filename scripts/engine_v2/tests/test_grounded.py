"""M2.1 selection tests: synthetic poses, bat geometry and generated media only."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import uuid
from unittest.mock import patch

from scripts.engine_v2.batter import select_batter
from scripts.engine_v2.bat_track import track_bats
from scripts.engine_v2.grounded import ground_batter
from scripts.engine_v2.identity import PROVISIONAL_SELECTION_THRESHOLDS, SELECTION_THRESHOLDS_SHA256
from scripts.engine_v2.run_engine import run
from scripts.engine_v2.schema import validate
from scripts.engine_v2.tests.test_engine import person, fixture
from scripts.engine_v2.tests.test_bat import candidate, frames_at, BatDouble


def scene(count=20, offsets=(0, 100), slices=None, weak_first=False, ineligible=()):
    frames = frames_at([i / 10 for i in range(count)])
    segments = []
    for j, offset in enumerate(offsets):
        rows = []
        for f in frames[slices[j] if slices else slice(None)]:
            p = person(j + 1, offset, grip=j not in ineligible)
            if weak_first and j == 0:
                p.box_xyxy = [20, 10, 60, 25]
            rows.append({**f, **vars(p), "display_height": 96})
        segments.append({"id": str(j), "track_id": str(j), "rows": rows})
    decision, candidates = select_batter(segments)
    return decision, candidates, segments, frames


def bats(indices, offset=100):
    return {i: [candidate([40 + offset, 35], [40 + offset, 5])] for i in indices}


class GroundedTests(unittest.TestCase):
    def test_exclusive_holder_and_cached_run(self):
        inputs = scene()
        self.assertEqual(inputs[0]["status"], "ambiguous")
        results = []
        def tracked(*args):
            result = track_bats(*args)
            results.append(result)
            return result
        with patch("scripts.engine_v2.grounded.track_bats", side_effect=tracked) as tracker:
            decision, evidence, result = ground_batter(*inputs, bats(range(20)), None)
        self.assertEqual(tracker.call_count, 2)
        self.assertIs(result, results[1])
        self.assertEqual((decision["status"], decision["segment_id"], decision["basis"]),
                         ("selected", "1", "pose_and_bat"))
        self.assertEqual([e["exclusive"] for e in evidence], [0, 20])
        json.dumps(evidence, allow_nan=False)

    def test_pose_bat_disagreement(self):
        inputs = scene(weak_first=True)
        self.assertEqual(inputs[0]["segment_id"], "1")
        # The smaller A still meets M1 eligibility; give it a proportionally sized bat.
        found = {i: [candidate([40, 35], [40, 23])] for i in range(20)}
        decision, _, _ = ground_batter(*inputs, found, None)
        self.assertEqual(decision["segment_id"], "0")
        self.assertEqual(decision["reason_codes"], ["POSE_BAT_DISAGREEMENT"])

    def test_two_holders_ambiguous_even_after_pose_selection(self):
        for weak in (False, True):
            inputs = scene(weak_first=weak)
            found = {i: [candidate([40, 35], [40, 23]), *bats([i])[i]] for i in range(20)}
            decision, _, result = ground_batter(*inputs, found, None)
            self.assertEqual(decision["status"], "ambiguous")
            self.assertEqual(decision["reason_codes"], ["BAT_EVIDENCE_AMBIGUOUS"])
            self.assertEqual(result[1], "not_evaluated")

    def test_shared_bat_counts_for_nobody(self):
        inputs = scene(offsets=(0, 5))
        decision, evidence, _ = ground_batter(*inputs, bats(range(20), 0), None)
        self.assertEqual([e["shared"] for e in evidence], [20, 20])
        self.assertEqual([e["exclusive"] for e in evidence], [0, 0])
        self.assertEqual(decision["status"], inputs[0]["status"])
        self.assertIn("NO_EXCLUSIVE_BAT_EVIDENCE", decision["reason_codes"])

    def test_shared_rounding_and_reversed_endpoint_order(self):
        inputs = scene(offsets=(0, 5))
        calls = 0
        def tracked(*args):
            nonlocal calls
            result = track_bats(*args)
            calls += 1
            if calls == 2:
                for r in result[0]:
                    if r["endpoints"]:
                        r["endpoints"] = [[v + .001 for v in p] for p in reversed(r["endpoints"])]
            return result
        with patch("scripts.engine_v2.grounded.track_bats", side_effect=tracked):
            _, evidence, _ = ground_batter(*inputs, bats(range(20), 0), None)
        self.assertEqual([e["shared"] for e in evidence], [20, 20])

    def test_short_eligible_fragment_cannot_win(self):
        inputs = scene(count=100, slices=(slice(None), slice(0, 6)))
        self.assertTrue(all(c["eligible"] for c in inputs[1]))
        decision, evidence, _ = ground_batter(*inputs, bats(range(6)), None)
        self.assertEqual(evidence[1]["exclusive_fraction"], .06)
        self.assertEqual(evidence[1]["exclusive"], evidence[1]["segment_frames"])
        self.assertEqual(decision["status"], "ambiguous")

    def test_ineligible_bat_holder_cannot_be_selected_or_share(self):
        inputs = scene(ineligible=(1,))
        decision, evidence, _ = ground_batter(*inputs, bats(range(20)), None)
        self.assertEqual(decision["segment_id"], "0")
        self.assertEqual([e["segment_id"] for e in evidence], ["0"])
        self.assertEqual(decision["basis"], "pose_only")
        inputs = scene(offsets=(0, 0), ineligible=(1,))
        decision, evidence, _ = ground_batter(*inputs, bats(range(20), 0), None)
        self.assertEqual(evidence[0]["exclusive"], 20)
        self.assertEqual(decision["basis"], "pose_and_bat")

    def test_no_bats_and_stage_failure_preserve_pose_fields(self):
        for inputs in (scene(), scene(offsets=(0,))):
            original = deepcopy(inputs)
            for failure, code in ((None, "NO_EXCLUSIVE_BAT_EVIDENCE"),
                                  ("BAT_MODEL_ERROR", "BAT_EVIDENCE_UNAVAILABLE")):
                decision, _, _ = ground_batter(*inputs, bats(range(20), 0) if failure else {}, failure)
                self.assertEqual(decision, {**inputs[0], "basis": "pose_only",
                                          "reason_codes": [*inputs[0]["reason_codes"], code]})
            self.assertEqual(inputs, original)

    def test_no_eligible_candidates_keeps_unavailable_exactly(self):
        inputs = scene(ineligible=(0, 1))
        for failure in (None, "BAT_MODEL_ERROR"):
            decision, evidence, _ = ground_batter(*inputs, bats(range(20)), failure)
            self.assertEqual(decision, inputs[0])
            self.assertEqual(decision["status"], "unavailable")
            self.assertEqual(evidence, [])

    def test_exact_fraction_span_and_margin_boundaries(self):
        inputs = scene()
        # Five/20 against one/20: exactly .25 coverage and .20 margin.
        # VFR PTS make the five direct detections span exactly .3 seconds.
        for f, tick in zip(inputs[3][:5], (0, 50, 100, 200, 300)):
            f["pts"], f["time_s"] = tick, tick / 1000
        found = bats(range(5))
        found[0] += bats([0], 0)[0]
        decision, evidence, _ = ground_batter(*inputs, found, None)
        self.assertEqual(decision["segment_id"], "1")
        self.assertEqual((evidence[1]["exclusive_fraction"], evidence[1]["exclusive_span_s"]), (.25, .3))
        # Just below each fixed boundary independently must fail closed.
        for kind in ("fraction", "span", "margin"):
            modified, detections = deepcopy(inputs), deepcopy(found)
            if kind == "fraction":
                del detections[1]
            elif kind == "span":
                modified[3][4]["pts"] = 299
            else:
                detections[1] += bats([1], 0)[1]
            self.assertEqual(ground_batter(*modified, detections, None)[0]["status"], "ambiguous", kind)

    def test_split_segments_are_not_merged(self):
        inputs = scene(count=60, offsets=(0, 0), slices=(slice(0, 10), slice(10, 20)))
        for s in inputs[2]: s["track_id"] = "same-person-track"
        decision, evidence, _ = ground_batter(*inputs, bats(range(20), 0), None)
        self.assertEqual([e["exclusive"] for e in evidence], [10, 10])
        self.assertEqual(decision["status"], "ambiguous")

    def test_interpolated_frames_are_not_evidence(self):
        inputs = scene(count=20, offsets=(0,))
        for f in inputs[3]:
            f["pts"] = f["index"] * 20
        _, evidence, _ = ground_batter(*inputs, bats((0, 4), 0), None)
        self.assertEqual(evidence[0]["detected"], 2)

    def test_threshold_hash_is_canonical(self):
        self.assertEqual(PROVISIONAL_SELECTION_THRESHOLDS, {
            "min_exclusive_fraction": .25, "min_exclusive_span_s": .3, "min_exclusive_margin": .20})
        self.assertEqual(SELECTION_THRESHOLDS_SHA256, hashlib.sha256(json.dumps(
            PROVISIONAL_SELECTION_THRESHOLDS, sort_keys=True, separators=(",", ":")).encode()).hexdigest())


class GroundedArtifactsTests(unittest.TestCase):
    def test_final_batter_artifacts_repeat_and_schema_rejects_disagreement(self):
        directory = Path(tempfile.gettempdir()) / f"engine-v2-grounded-{uuid.uuid4().hex}"
        directory.mkdir(mode=0o755)
        self.addCleanup(shutil.rmtree, directory)
        video = directory / "synthetic.mp4"
        fixture(video)
        class TwoPeople:
            def detect(self, raster, index):
                return [person(), person(2, 100)]
        outputs = [directory / str(i) for i in range(2)]
        for output in outputs:
            self.assertEqual(run(video, output, TwoPeople(), bat_model=BatDouble(), device="cpu",
                                 clock=lambda: 0.0, now=lambda: "2026-01-01T00:00:00Z"), "complete")
        artifacts = {p.name: json.loads(p.read_text()) for p in outputs[0].glob("*.json")}
        validate(artifacts)
        grounding = artifacts["tracks.json"]["grounding"]
        self.assertEqual(grounding["pose_decision"]["status"], "ambiguous")
        self.assertEqual(grounding["final_decision"]["segment_id"], "1:0")
        self.assertTrue(all(r["status"] == "detected" for r in artifacts["bat_path.json"]["frames"]))
        self.assertTrue(all(r["keypoints"][9][0] == 38 for r in artifacts["pose_2d.json"]["frames"]))
        self.assertEqual({p.name: p.read_bytes() for p in outputs[0].glob("*.json")},
                         {p.name: p.read_bytes() for p in outputs[1].glob("*.json")})
        for name in ("tracks.json", "metrics.json", "pose_2d.json"):
            broken = deepcopy(artifacts)
            decision = broken[name]["meta"]["batter_selection"] if name == "pose_2d.json" else broken[name]["batter"]
            decision["segment_id"] = "2:1"
            with self.assertRaises(AssertionError): validate(broken)
        for field, value in (("thresholds_sha256", "wrong"), ("evidence", []), ("final_decision", {})):
            broken = deepcopy(artifacts)
            broken["tracks.json"]["grounding"][field] = value
            with self.assertRaises((AssertionError, KeyError)): validate(broken)


if __name__ == "__main__": unittest.main()
