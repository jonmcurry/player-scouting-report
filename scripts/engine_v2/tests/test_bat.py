"""M2 bat geometry, association and tracking. Synthetic masks and media only."""
from contextlib import redirect_stderr
import io
import json
from math import cos, dist, radians, sin
from pathlib import Path
import shutil
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch
import numpy as np
from scripts.engine_v2.bat_geometry import mask_geometry
from scripts.engine_v2.bat_model import BatMask, YoloBatSegmenter, SEG_MODEL
from scripts.engine_v2.bat_track import track_bats, _interpolate, _eligible
from scripts.engine_v2.identity import Unavailable
from scripts.engine_v2.run_engine import run
from scripts.engine_v2.schema import validate
from scripts.engine_v2.tests.test_engine import Double, NoBat, fixture, person

H = 200.0  # synthetic batter box height in pixels


def tapered_mask(shape, knob, tip, r_knob=4.0, r_tip=10.0):
    """Tapered capsule; returns the mask and its true extreme points along the bat axis."""
    knob, tip = np.asarray(knob, float), np.asarray(tip, float)
    axis = tip - knob
    length = float(np.hypot(*axis))
    unit = axis / length
    ys, xs = np.mgrid[:shape[0], :shape[1]]
    rel = np.stack([xs - knob[0], ys - knob[1]], axis=-1)
    t = np.clip(rel @ unit / length, 0.0, 1.0)
    closest = knob + t[..., None] * axis
    radius = r_knob + (r_tip - r_knob) * t
    mask = np.hypot(xs - closest[..., 0], ys - closest[..., 1]) <= radius
    return mask, [list(knob - unit * r_knob), list(tip + unit * r_tip)]


def endpoint_error(found, truth):
    a = max(dist(found[0], truth[0]), dist(found[1], truth[1]))
    b = max(dist(found[0], truth[1]), dist(found[1], truth[0]))
    return min(a, b)


def angle_error(found, truth_angle):
    d = abs(found - truth_angle % 180)
    return min(d, 180 - d)


def frames_at(times, base=1000):
    return [{"index": i, "pts": round(t * base), "time_base": [1, base], "time_s": round(t, 6)} for i, t in enumerate(times)]


def batter(hand, wrists=2, box_top=0.0):
    p = [[0.0, 0.0, 0.99] for _ in range(17)]
    p[9] = [hand[0] - 3, hand[1], 0.99 if wrists >= 1 else 0.1]
    p[10] = [hand[0] + 3, hand[1], 0.99 if wrists >= 2 else 0.1]
    if wrists == 1:
        p[9] = [hand[0], hand[1], 0.99]
    return {"keypoints17": p, "box_xyxy": [0.0, box_top, 100.0, box_top + H]}


def candidate(knob, tip, score=0.8, width=12.0):
    length = dist(knob, tip)
    return {"ok": True, "reason_codes": [], "endpoints": [list(knob), list(tip)], "length_px": length,
            "width_px": width, "elongation": length / width, "angle_deg": 0.0, "fragmented": False, "score": score}


def along(origin, angle, length):
    return [origin[0] + length * cos(radians(angle)), origin[1] + length * sin(radians(angle))]


class GeometryTests(unittest.TestCase):
    def test_known_geometry_endpoint_and_angle_error(self):
        table = []
        for angle in (0, 15, 30, 45, 60, 90, 120, 135, 150, 170):
            for length in (120, 200, 300):
                knob = [320 - length / 2 * cos(radians(angle)), 240 - length / 2 * sin(radians(angle))]
                tip = along(knob, angle, length)
                mask, truth = tapered_mask((480, 640), knob, tip)
                g = mask_geometry(mask)
                self.assertTrue(g["ok"], (angle, length, g))
                table.append((angle, length, endpoint_error(g["endpoints"], truth), angle_error(g["angle_deg"], angle)))
        worst = max(r[2] for r in table)
        mean = sum(r[2] for r in table) / len(table)
        worst_angle = max(r[3] for r in table)
        print(f"\n[bat geometry] {len(table)} synthetic masks: endpoint error max {worst:.2f}px mean {mean:.2f}px; "
              f"angle error max {worst_angle:.2f} deg")
        self.assertLess(worst, 3.0)
        self.assertLess(worst_angle, 1.0)

    def test_degenerate_masks_are_rejected_with_reasons(self):
        empty = np.zeros((100, 100), bool)
        tiny = empty.copy(); tiny[50:53, 50:53] = True
        ys, xs = np.mgrid[:100, :100]
        disc = np.hypot(xs - 50, ys - 50) <= 20
        square = empty.copy(); square[30:70, 30:70] = True
        stubby = empty.copy(); stubby[40:60, 30:70] = True
        for mask, reason in ((empty, "EMPTY_MASK"), (tiny, "TOO_FEW_PIXELS"), (disc, "DEGENERATE_AXIS"),
                             (square, "DEGENERATE_AXIS"), (stubby, "NOT_ELONGATED")):
            g = mask_geometry(mask)
            self.assertFalse(g["ok"])
            self.assertEqual(g["reason_codes"], [reason])
            self.assertNotIn("endpoints", g)

    def test_fragmented_occluded_and_blurred_masks(self):
        knob, tip = [100, 200], [400, 120]
        mask, truth = tapered_mask((320, 520), knob, tip)
        # A hand crossing the handle splits the mask into collinear parts: accepted, flagged.
        occluded = mask.copy()
        cut = along(knob, -14.93, 60)
        ys, xs = np.mgrid[:320, :520]
        occluded[np.hypot(xs - cut[0], ys - cut[1]) <= 9] = False
        g = mask_geometry(occluded)
        self.assertTrue(g["ok"] and g["fragmented"])
        self.assertLess(endpoint_error(g["endpoints"], truth), 3.0)
        # A significant non-collinear blob (another object) makes the mask unusable.
        scattered = mask.copy(); scattered[20:60, 20:60] = True
        self.assertEqual(mask_geometry(scattered)["reason_codes"], ["FRAGMENTED_MASK"])
        # A collinear object far beyond the barrel is not the same bat: never merged into a longer one.
        level, _ = tapered_mask((300, 1200), [50, 150], [350, 150])
        beyond, _ = tapered_mask((300, 1200), [950, 150], [1110, 150])
        self.assertTrue(beyond.any())
        self.assertEqual(mask_geometry(level | beyond)["reason_codes"], ["FRAGMENTED_MASK"])
        near, _ = tapered_mask((300, 1200), [372, 150], [450, 150])  # short gap: occlusion-sized
        self.assertTrue(mask_geometry(level | near)["ok"])
        # Barrel hidden: a shorter but valid segment, never extended.
        partial = mask & (xs < 260)
        g = mask_geometry(partial)
        self.assertTrue(g["ok"])
        self.assertLess(g["length_px"], mask_geometry(mask)["length_px"] * 0.6)
        # Motion blur widens the mask: still elongated -> accepted; heavy smear -> NOT_ELONGATED.
        from cv2 import dilate
        mild = dilate(mask.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
        self.assertTrue(mask_geometry(mild)["ok"])
        heavy = dilate(mask.astype(np.uint8), np.ones((1, 1), np.uint8))
        heavy = dilate(heavy, np.ones((140, 1), np.uint8)).astype(bool)
        self.assertEqual(mask_geometry(heavy)["reason_codes"], ["NOT_ELONGATED"])


class TrackTests(unittest.TestCase):
    def setUp(self):
        self.hand = [200.0, 300.0]

    def detected_bat(self, angle=-30.0, length=100.0, hand=None):
        hand = hand or self.hand
        return candidate(hand, along(hand, angle, length))

    def test_association_accepts_batter_bat_and_rejects_others(self):
        frames = frames_at([0.0])
        rows, status, _ = track_bats(frames, {0: batter(self.hand)}, {0: [self.detected_bat()]})
        self.assertEqual((status, rows[0]["status"], rows[0]["knob_source"]), ("observed", "detected", "hands"))
        self.assertLess(dist(rows[0]["knob"], self.hand), 1e-6)
        far = candidate([600, 300], [700, 250])  # on-deck or a second bat far from the hands
        rows, status, _ = track_bats(frames, {0: batter(self.hand)}, {0: [far]})
        self.assertEqual((status, rows[0]["status"], rows[0]["reason_codes"]), ("not_detected", "missing", ["NOT_NEAR_BATTER_HANDS"]))
        rows, _, _ = track_bats(frames, {0: batter(self.hand)}, {0: [far, self.detected_bat()]})
        self.assertEqual(rows[0]["status"], "detected")
        self.assertEqual(rows[0]["candidate_count"], 2)

    def test_competing_and_duplicate_candidates(self):
        frames = frames_at([0.0])
        second = candidate([self.hand[0] + 4, self.hand[1] + 4], along([self.hand[0] + 4, self.hand[1] + 4], 160, 100))
        rows, _, _ = track_bats(frames, {0: batter(self.hand)}, {0: [self.detected_bat(), second]})
        self.assertEqual((rows[0]["status"], rows[0]["reason_codes"]), ("ambiguous_candidate", ["MULTIPLE_BAT_CANDIDATES"]))
        self.assertIsNone(rows[0]["tip"])
        bat = self.detected_bat()
        duplicate = candidate([p + 1 for p in bat["endpoints"][0]], [p + 1 for p in bat["endpoints"][1]], score=0.5)
        rows, _, _ = track_bats(frames, {0: batter(self.hand)}, {0: [bat, duplicate]})
        self.assertEqual((rows[0]["status"], rows[0]["conf"]), ("detected", 0.8))

    def test_wrist_and_pose_availability(self):
        frames = frames_at([0.0, 1 / 30, 2 / 30])
        rows, _, _ = track_bats(frames, {0: batter(self.hand, wrists=1), 1: batter(self.hand, wrists=0)},
                                {i: [self.detected_bat()] for i in range(3)})
        self.assertEqual((rows[0]["status"], rows[0]["reason_codes"]), ("detected", ["SINGLE_WRIST"]))
        self.assertEqual((rows[1]["status"], rows[1]["reason_codes"]), ("missing", ["NO_CONFIDENT_WRIST"]))
        self.assertEqual((rows[2]["status"], rows[2]["reason_codes"]), ("missing", ["NO_BATTER_POSE"]))
        rows, status, reasons = track_bats(frames, {}, {i: [self.detected_bat()] for i in range(3)})
        self.assertEqual((status, reasons, {r["status"] for r in rows}), ("not_evaluated", ["NO_BATTER_SELECTED"], {"not_evaluated"}))
        rows, status, reasons = track_bats(frames, {0: batter(self.hand)}, {}, failure="BAT_MODEL_MISSING")
        self.assertEqual((status, reasons, rows[0]["reason_codes"]), ("unavailable", ["BAT_MODEL_MISSING"], ["BAT_STAGE_UNAVAILABLE"]))

    def test_endpoint_identity_ambiguity_continuity_and_flip_conflict(self):
        # An 80 px bat with the hands at its middle: both ends 0.2 H away, inside reach.
        middle = [self.hand[0] + 40 * cos(radians(-30)), self.hand[1] + 40 * sin(radians(-30))]
        bat = self.detected_bat(length=80.0)
        frames = frames_at([0.0, 1 / 30])
        # Hands at the middle of the bat: identity cannot come from the hands.
        rows, _, _ = track_bats(frames[:1], {0: batter(middle)}, {0: [bat]})
        self.assertEqual((rows[0]["status"], rows[0]["reason_codes"]), ("ambiguous_orientation", ["ENDPOINT_IDENTITY_AMBIGUOUS"]))
        self.assertIsNone(rows[0]["knob"])
        self.assertEqual(len(rows[0]["endpoints"]), 2)
        # With a recent direct frame, continuity resolves it and says so.
        rows, _, _ = track_bats(frames, {0: batter(self.hand), 1: batter(middle)}, {0: [bat], 1: [bat]})
        self.assertEqual((rows[1]["status"], rows[1]["knob_source"]), ("detected", "temporal_continuity"))
        self.assertEqual(rows[1]["knob"], rows[0]["knob"])
        # Hands decisively at the other end while the bat did not move: never silently swap.
        tip = bat["endpoints"][1]
        rows, _, _ = track_bats(frames, {0: batter(self.hand), 1: batter(tip)}, {0: [bat], 1: [bat]})
        self.assertEqual((rows[1]["status"], rows[1]["reason_codes"]), ("ambiguous_orientation", ["ENDPOINT_FLIP_CONFLICT"]))
        self.assertIsNone(rows[1]["tip"])

    def test_fast_legitimate_rotation_keeps_identity(self):
        frames = frames_at([i / 30 for i in range(6)])
        bats = {i: [self.detected_bat(angle=-90 + 60 * i)] for i in range(6)}
        rows, _, _ = track_bats(frames, {i: batter(self.hand) for i in range(6)}, bats)
        self.assertEqual({r["status"] for r in rows}, {"detected"})
        self.assertTrue(all(dist(r["knob"], self.hand) < 1e-6 for r in rows))
        self.assertEqual({r["track_id"] for r in rows}, {1})

    def test_discontinuity_is_never_detected_until_the_window_lapses(self):
        # A sudden jump from a recent direct bat (another object near the hands, or a bad mask) is not
        # accepted; a new segment may start only once the continuity window has passed.
        # Consecutive 30 fps frames: the jumped object stays rejected even though its rate against the
        # older reference falls below the limit (0.5 H over 67 ms is 7.5 H/s).
        times = [i / 30 for i in range(5)] + [0.2]
        frames = frames_at(times)
        moved = [self.hand[0] + 0.5 * H, self.hand[1]]
        poses = {i: batter(self.hand if i == 0 else moved) for i in range(len(times))}
        bats = {0: [self.detected_bat()], **{i: [self.detected_bat(hand=moved)] for i in range(1, len(times))}}
        rows, _, _ = track_bats(frames, poses, bats)
        self.assertEqual([r["status"] for r in rows],
                         ["detected"] + ["ambiguous_candidate"] * 3 + ["detected", "detected"])
        self.assertTrue(all("BAT_TRACK_DISCONTINUITY" in r["reason_codes"] for r in rows[1:4]))
        self.assertTrue(all((r["tip"], r["track_id"]) == (None, None) for r in rows[1:4]))
        # Frame 4 (133 ms) is past the 0.1 s window: a new segment, never the old one.
        self.assertEqual([rows[0]["track_id"], rows[4]["track_id"], rows[5]["track_id"]], [1, 2, 2])

    def test_real_bat_reappearing_after_a_bad_mask_is_accepted(self):
        # A one-frame pose glitch moves the hands, and a mask there is eligible but jumps: rejected and
        # held. Next frame the real bat is back at the trusted position and is accepted on the same track.
        frames = frames_at([0.0, 1 / 30, 2 / 30])
        moved = [self.hand[0] + 0.5 * H, self.hand[1]]
        poses = {0: batter(self.hand), 1: batter(moved), 2: batter(self.hand)}
        bats = {0: [self.detected_bat()], 1: [self.detected_bat(hand=moved)], 2: [self.detected_bat()]}
        rows, _, _ = track_bats(frames, poses, bats)
        self.assertEqual([r["status"] for r in rows], ["detected", "ambiguous_candidate", "detected"])
        self.assertIn("BAT_TRACK_DISCONTINUITY", rows[1]["reason_codes"])
        self.assertEqual(rows[2]["track_id"], rows[0]["track_id"])

    def test_jump_hold_clears_after_the_window_even_without_pose(self):
        frames = frames_at([0.0, 1 / 30, 2 / 30, 0.2])
        moved = [self.hand[0] + 0.5 * H, self.hand[1]]
        poses = {0: batter(self.hand), 1: batter(moved), 3: batter(moved)}  # frame 2 has no batter pose
        bats = {0: [self.detected_bat()], 1: [self.detected_bat(hand=moved)], 3: [self.detected_bat(hand=moved)]}
        rows, _, _ = track_bats(frames, poses, bats)
        self.assertEqual([r["status"] for r in rows], ["detected", "ambiguous_candidate", "missing", "detected"])
        self.assertEqual(rows[3]["track_id"], 2)

    def test_perpendicular_stub_is_not_merged_as_a_duplicate(self):
        bat = self.detected_bat(angle=0.0)
        centre = along(self.hand, 0.0, 20)
        stub = candidate([centre[0], centre[1] - 0.05 * H], [centre[0], centre[1] + 0.05 * H])
        # Both survive de-duplication (a crossing object is never silently folded into the bat);
        # ranking then decides or reports ambiguity.
        unique, _ = _eligible([bat, stub], self.hand, H)
        self.assertEqual(len(unique), 2)
        handle = candidate(bat["endpoints"][0], along(bat["endpoints"][0], 0.0, 40))
        self.assertEqual(len(_eligible([bat, handle], self.hand, H)[0]), 1)

    def test_fast_rotation_with_moving_hands_is_not_a_flip_conflict(self):
        # 150 degrees per frame at 30 fps while the hands move 0.1 H: endpoint motion is large, so
        # continuity is silent and the decisive hands keep the identity (no dropped contact frames).
        frames = frames_at([i / 30 for i in range(4)])
        hands_at = [[self.hand[0] + 0.1 * H * i, self.hand[1]] for i in range(4)]
        bats = {i: [self.detected_bat(angle=-90 + 150 * i, hand=hands_at[i])] for i in range(4)}
        rows, _, _ = track_bats(frames, {i: batter(hands_at[i]) for i in range(4)}, bats)
        self.assertEqual([r["status"] for r in rows], ["detected"] * 4)
        self.assertTrue(all(r["knob_source"] == "hands" for r in rows))

    def test_partial_handle_mask_is_the_same_bat(self):
        bat = self.detected_bat()
        handle = candidate(bat["endpoints"][0], along(bat["endpoints"][0], -30, 40), score=0.95)
        rows, _, _ = track_bats(frames_at([0.0]), {0: batter(self.hand)}, {0: [handle, bat]})
        self.assertEqual((rows[0]["status"], rows[0]["length_px"]), ("detected", bat["length_px"]))

    def test_interpolation_is_short_labelled_and_pts_weighted(self):
        times = [0.0, 0.02, 0.07, 0.09]  # VFR: uneven spacing inside a 0.09 s gap
        frames = frames_at(times)
        hand_b = [self.hand[0] + 9, self.hand[1]]
        poses = {i: batter(self.hand if i < 3 else hand_b) for i in range(4)}
        rows, _, _ = track_bats(frames, poses, {0: [self.detected_bat()], 3: [self.detected_bat(hand=hand_b)]})
        self.assertEqual([r["status"] for r in rows], ["detected", "interpolated", "interpolated", "detected"])
        for i in (1, 2):
            w = times[i] / times[3]
            self.assertAlmostEqual(rows[i]["interpolated"]["knob"][0], self.hand[0] + 9 * w, places=1)
            self.assertIsNone(rows[i]["tip"])
            self.assertIn("INTERPOLATED_SHORT_GAP", rows[i]["reason_codes"])
        self.assertEqual(sum(r["tip"] is not None for r in rows), sum(r["status"] == "detected" for r in rows))

    def test_no_interpolation_for_long_sparse_or_contested_gaps(self):
        bat = self.detected_bat()
        long_gap = frames_at([0.0, 0.1, 0.2])
        rows, _, _ = track_bats(long_gap, {i: batter(self.hand) for i in range(3)}, {0: [bat], 2: [bat]})
        self.assertEqual(rows[1]["status"], "missing")
        self.assertEqual([rows[0]["track_id"], rows[2]["track_id"]], [1, 2])  # sparse: continuity not assumed
        # A frame whose only bat is away from the hands is not bridged: a bat was seen elsewhere.
        contested = frames_at([0.0, 1 / 30, 2 / 30])
        far = candidate([600, 300], [700, 250])
        rows, _, _ = track_bats(contested, {i: batter(self.hand) for i in range(3)}, {0: [bat], 1: [far], 2: [bat]})
        self.assertEqual((rows[1]["status"], rows[1]["interpolated"]), ("missing", None))
        # Nor is a frame with competing candidates (constructed directly; continuity usually resolves it).
        rows[1].update(status="ambiguous_candidate", reason_codes=["MULTIPLE_BAT_CANDIDATES"])
        _interpolate(rows, contested)
        self.assertEqual((rows[1]["status"], rows[1]["interpolated"]), ("ambiguous_candidate", None))


class BatDouble:
    """Masks a bat held at the synthetic person's hands (160x96 fixture raster)."""
    def __init__(self, mode="bat"): self.mode = mode

    def segment(self, raster, index):
        if self.mode == "crash" and index == 3: raise RuntimeError("synthetic bat model failure")
        if self.mode in ("none", "crash"): return []
        mask, _ = tapered_mask(raster.shape[:2], [40, 36], [100, 12], r_knob=2.0, r_tip=4.0)
        return [BatMask(mask, 0.6)]


class EndToEndTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.gettempdir()) / f"engine-v2-bat-{uuid.uuid4().hex}"
        self.directory.mkdir(mode=0o755)
        self.addCleanup(shutil.rmtree, self.directory)
        self.video = self.directory / "raw.mp4"
        fixture(self.video)

    def artifacts(self, out):
        return {p.name: json.loads(p.read_text()) for p in out.glob("*.json")}

    def go(self, name, detector, bat_model):
        out = self.directory / name
        status = run(self.video, out, detector, device="cpu", bat_model=bat_model,
                     clock=lambda: 0.0, now=lambda: "2026-01-01T00:00:00Z")
        return status, out

    def test_bat_observed_deterministic_and_never_fabricated(self):
        outs = [self.go(f"bat-{i}", Double(), BatDouble())[1] for i in range(2)]
        a = self.artifacts(outs[0])
        validate(a)
        bat = a["bat_path.json"]
        self.assertEqual(bat["meta"]["bat_status"], "observed")
        self.assertEqual({f["status"] for f in bat["frames"]}, {"detected"})
        self.assertTrue(all(dist(f["knob"], [40, 36]) < 3 for f in bat["frames"]))
        self.assertEqual(a["pipeline_status.json"]["detail"]["bat_status"], "observed")
        self.assertEqual({p.name: p.read_bytes() for p in outs[0].glob("*.json")},
                         {p.name: p.read_bytes() for p in outs[1].glob("*.json")})

    def test_no_bat_no_person_and_bat_failures_keep_batter_result(self):
        baseline_status, baseline_out = self.go("nobat", Double(), NoBat())
        self.assertEqual(self.artifacts(baseline_out)["bat_path.json"]["meta"]["bat_status"], "not_detected")
        status, out = self.go("noperson", Double("empty"), BatDouble())
        self.assertEqual(status, "analysis_unavailable")
        self.assertEqual(self.artifacts(out)["bat_path.json"]["meta"]["bat_status"], "not_evaluated")
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            status, out = self.go("crash", Double(), BatDouble("crash"))
        self.assertIn("synthetic bat model failure", stderr.getvalue())
        a = self.artifacts(out)
        validate(a)
        self.assertEqual(status, baseline_status)
        baseline_pose = self.artifacts(baseline_out)["pose_2d.json"]
        self.assertEqual(a["pose_2d.json"]["frames"], baseline_pose["frames"])
        self.assertEqual(a["pose_2d.json"]["meta"]["batter_selection"], {
            **baseline_pose["meta"]["batter_selection"], "reason_codes": ["BAT_EVIDENCE_UNAVAILABLE"]})
        self.assertEqual((a["bat_path.json"]["meta"]["bat_status"], a["bat_path.json"]["meta"]["bat_reason_codes"]),
                         ("unavailable", ["BAT_MODEL_ERROR"]))
        self.assertTrue(all(f["tip"] is None for f in a["bat_path.json"]["frames"]))
        with patch("scripts.engine_v2.run_engine.YoloBatSegmenter", side_effect=Unavailable("BAT_MODEL_MISSING")):
            status, out = self.go("missing", Double(), None)
        self.assertEqual(status, baseline_status)
        self.assertEqual(self.artifacts(out)["pipeline_status.json"]["detail"]["bat_reason_codes"], ["BAT_MODEL_MISSING"])

    def test_model_identity_is_pinned(self):
        with self.assertRaisesRegex(Unavailable, "BAT_MODEL_MISSING"):
            YoloBatSegmenter(model_path=self.directory / "absent.pt")
        fake = self.directory / "fake.pt"
        fake.write_bytes(b"not the pinned weights")
        with self.assertRaisesRegex(Unavailable, "BAT_MODEL_HASH_MISMATCH"):
            YoloBatSegmenter(model_path=fake)


@unittest.skipUnless(SEG_MODEL.is_file(), "segmentation weights absent; never download")
class RealModelTests(unittest.TestCase):
    def test_real_segmenter_offline_class_and_bounded_gpu_time(self):
        import torch
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        with patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")), \
             patch("ultralytics.utils.downloads.safe_download", side_effect=AssertionError("download forbidden")):
            segmenter = YoloBatSegmenter(device)
        self.assertEqual(segmenter.model.names[34], "baseball bat")
        frame = np.full((720, 1280, 3), (60, 110, 60), np.uint8)
        mask, _ = tapered_mask(frame.shape[:2], [500, 420], [820, 260], 8.0, 30.0)
        frame[mask] = (40, 120, 190)
        segmenter.segment(frame, 0)  # warm-up
        started = time.perf_counter()
        found = [len(segmenter.segment(frame, i)) for i in range(30)]
        elapsed = time.perf_counter() - started
        # Synthetic imagery is not evidence about real bats; record, never assert, detection.
        print(f"\n[bat model] {device}: 30 synthetic 720p frames in {elapsed:.2f}s; masks per frame {sorted(set(found))}")
        self.assertLess(elapsed, 30.0 if device != "cpu" else 120.0)


if __name__ == "__main__": unittest.main()
