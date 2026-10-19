from fractions import Fraction
from contextlib import redirect_stderr
import io
import json
from pathlib import Path
import subprocess
import tempfile
import shutil
import uuid
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import av
import numpy as np
from scripts.engine_v2.decode import decode, validate_pts, displayed_raster, aggregates
from scripts.engine_v2.identity import Unavailable
from scripts.engine_v2.tracking import PersonDetection, YoloDetector, MODEL
from scripts.engine_v2.continuity import split_tracks
from scripts.engine_v2.batter import select_batter
from scripts.engine_v2.run_engine import run, ARTIFACTS
from scripts.engine_v2.schema import validate


def fixture(path, vfr=False, count=24, bright_block=False):
    pts = [i * 100 + (i % 3) * 10 if vfr else i * 100 for i in range(count)]
    with av.open(str(path), "w") as container:
        stream = container.add_stream("libx264", rate=10)
        stream.width, stream.height = 160, 96
        stream.pix_fmt = "yuv420p"
        stream.time_base = Fraction(1, 1000)
        stream.codec_context.time_base = Fraction(1, 1000)
        for tick in pts:
            raster = np.zeros((96, 160, 3), dtype=np.uint8)
            if bright_block:
                raster[:24, :40] = 255
            frame = av.VideoFrame.from_ndarray(raster, format="bgr24")
            frame.pts, frame.time_base = tick, Fraction(1, 1000)
            for packet in stream.encode(frame): container.mux(packet)
        for packet in stream.encode(): container.mux(packet)
    return pts


def person(track=1, offset=0, grip=True):
    p = [[40 + offset, 30, 0.99] for _ in range(17)]
    p[5], p[6], p[11], p[12] = [30+offset, 25, .99], [50+offset, 25, .99], [32+offset, 60, .99], [48+offset, 60, .99]
    p[9], p[10] = [38+offset, 35, .99], [42+offset if grip else 90+offset, 35, .99]
    return PersonDetection(track, [20+offset, 10, 60+offset, 90], .99, p)


class Double:
    def __init__(self, mode="selected"): self.mode = mode

    def detect(self, raster, index):
        if self.mode == "crash": raise RuntimeError("synthetic crash")
        if self.mode == "empty": return []
        if self.mode == "ambiguous": return [person(), person(2, 70)]
        return [person(grip=self.mode != "no_grip")]


class NoBat:
    """Bat-model double for M1-focused tests: the model ran and found nothing."""
    def segment(self, raster, index): return []


def rows(count=20, grip=True, switch=False, gap=False):
    return [{"index": i, "pts": i * 100 + (1000 if gap and i >= count//2 else 0),
             "time_base": [1, 1000], "display_height": 96,
             **vars(person(offset=100 if switch and i >= count//2 else 0, grip=grip))} for i in range(count)]


class EngineTests(unittest.TestCase):
    def setUp(self):
        # Python 3.12's Windows mode=0700 temp ACL excludes restricted tokens.
        self.directory = Path(tempfile.gettempdir()) / f"engine-v2-{uuid.uuid4().hex}"
        self.directory.mkdir(mode=0o755)
        self.addCleanup(shutil.rmtree, self.directory)

    def test_zero_frame_decode_without_exception(self):
        path = self.directory / "empty-decode.bin"
        path.write_bytes(b"synthetic input; decoder is patched")
        out = self.directory / "empty-decode"
        with patch("scripts.engine_v2.run_engine.decode", return_value=iter(())):
            self.assertEqual(run(path, out, Double(), device="cpu", bat_model=NoBat()),
                             "analysis_unavailable")
        artifacts = {p.name: json.loads(p.read_text()) for p in out.glob("*.json")}
        validate(artifacts)
        self.assertEqual(artifacts["bat_path.json"]["meta"]["bat_status"], "unavailable")
        self.assertIn("DECODE_UNAVAILABLE", artifacts["bat_path.json"]["meta"]["bat_reason_codes"])
        self.assertEqual(artifacts["metrics.json"]["batter"]["status"], "unavailable")
        self.assertEqual(artifacts["pipeline_status.json"]["status"], "analysis_unavailable")
        self.assertEqual(artifacts["frame_map.json"]["frames"], [])

    def test_cfr_and_vfr_match_authored_and_ffprobe(self):
        for vfr in (False, True):
            path = self.directory / f"{vfr}.mp4"
            authored = fixture(path, vfr)
            metadata = {}
            decoded = [r for r, _ in decode(path, metadata)]
            probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0",
                  "-show_frames", "-show_entries", "frame=pts", "-of", "json", str(path)]))
            self.assertEqual([r["pts"] for r in decoded], [r["pts"] for r in probe["frames"]])
            self.assertEqual([r["index"] for r in decoded], list(range(24)))
            self.assertEqual([r["time_s"] for r in decoded], [p/1000 for p in authored])
            self.assertEqual(aggregates(decoded)["vfr"], vfr)
            if vfr:
                self.assertTrue(any(abs(r["time_s"] - r["index"]/metadata["nominal_rate"]) > .001 for r in decoded))

    def test_invalid_pts_direct_validator(self):
        # Muxers repair/reject these inputs; test the actual decoder validator directly.
        for pts, previous, reason in ((None, None, "MISSING_PTS"), (1, 1, "NONINCREASING_PTS"), (0, 1, "NONINCREASING_PTS")):
            with self.assertRaisesRegex(Unavailable, reason): validate_pts(pts, previous)

    def test_rotation_and_limit(self):
        path, rotated = self.directory / "raw.mp4", self.directory / "rotated.mp4"
        fixture(path)
        subprocess.run(["ffmpeg", "-v", "error", "-display_rotation:v:0", "90", "-i", str(path), "-c", "copy", str(rotated)], check=True)
        metadata = {}
        raster = next(decode(rotated, metadata))[1]
        self.assertEqual((metadata["width"], metadata["height"]), (96, 160))
        self.assertEqual(raster.shape[:2], (160, 96))
        asymmetric = np.arange(18).reshape(2, 3, 3)
        self.assertTrue(np.array_equal(displayed_raster(asymmetric, 90), np.rot90(asymmetric)))
        with self.assertRaisesRegex(Unavailable, "UNSUPPORTED_ROTATION"): displayed_raster(asymmetric, 45)
        with self.assertRaisesRegex(Unavailable, "CLIP_TOO_LONG"): list(decode(path, {}, 2))

    def test_continuity_selection(self):
        _, segments, events = split_tracks(rows())
        self.assertFalse(events)
        self.assertEqual(select_batter(segments)[0]["status"], "selected")
        for switch, gap, reason in ((True, False, "CENTRE_JUMP"), (False, True, "LONG_GAP")):
            _, segments, events = split_tracks(rows(count=8, switch=switch, gap=gap))
            self.assertEqual(len(segments), 2)
            self.assertIn(reason, events[0]["reason_codes"])
            self.assertEqual(select_batter(segments)[0]["status"], "unavailable")
        _, segments, _ = split_tracks(rows(count=100, grip=False))
        self.assertEqual(select_batter(segments)[0]["status"], "unavailable")

    def test_rotation_direction_matches_ffmpeg_autorotation(self):
        original = self.directory / "bright-block.mp4"
        fixture(original, count=1, bright_block=True)

        def quadrant(raster):
            y, x = np.nonzero(raster.mean(axis=2) > 200)
            self.assertGreater(len(x), 0, "bright block must survive decoding")
            return ("top" if y.mean() < raster.shape[0] / 2 else "bottom") + "-" + (
                "left" if x.mean() < raster.shape[1] / 2 else "right")

        for degrees, expected in ((90, "bottom-left"), (-90, "top-right"), (180, "bottom-right")):
            with self.subTest(degrees=degrees):
                rotated = self.directory / f"rotated-{degrees}.mp4"
                raw = self.directory / f"autorotated-{degrees}.raw"
                subprocess.run(["ffmpeg", "-v", "error", "-display_rotation:v:0", str(degrees),
                                "-i", str(original), "-c", "copy", str(rotated)], check=True)
                metadata = {}
                decoded = list(decode(rotated, metadata))
                self.assertEqual(len(decoded), 1)
                subprocess.run(["ffmpeg", "-v", "error", "-i", str(rotated), "-frames:v", "1",
                                "-f", "rawvideo", "-pix_fmt", "bgr24", str(raw)], check=True)
                reference = np.frombuffer(raw.read_bytes(), dtype=np.uint8).reshape(
                    metadata["height"], metadata["width"], 3)
                self.assertEqual(quadrant(reference), expected)
                self.assertEqual(quadrant(decoded[0][1]), quadrant(reference))

    def test_auto_device_resolution_and_manifest(self):
        path = self.directory / "device.mp4"
        fixture(path, count=1)
        for available, expected in ((True, "cuda:0"), (False, "cpu")):
            out = self.directory / f"device-{available}"
            with patch("torch.cuda.is_available", return_value=available), \
                 patch("scripts.engine_v2.run_engine.YoloDetector", return_value=Double("empty")) as detector,                  patch("scripts.engine_v2.run_engine.YoloBatSegmenter", return_value=NoBat()) as segmenter:
                self.assertEqual(run(path, out), "analysis_unavailable")
                detector.assert_called_once_with(expected)
                segmenter.assert_called_once_with(expected)
            self.assertEqual(json.loads((out / "engine_manifest.json").read_text())["device"], expected)

    def test_high_fps_centre_jitter_does_not_split(self):
        observations = rows(count=240)
        signs = np.random.default_rng(0).choice([-1, 1], len(observations))
        for i, row in enumerate(observations):
            row.update(pts=i, time_base=[1, 240])
            row.update(vars(person(offset=80 * .02 * int(signs[i]))))
        tracks, segments, events = split_tracks(observations)
        self.assertEqual(len(segments), 1)
        self.assertEqual(events, [])
        for step in tracks[0]["steps"]:
            reference = max(0, step["index"] - 8)
            self.assertEqual(step["centre_reference_index"], reference)
            self.assertAlmostEqual(step["centre_elapsed_s"], (step["index"] - reference) / 240)

    def test_high_fps_segment_start_jitter_uses_window_floor(self):
        # Every row is younger than the window, so elapsed is one 240 fps frame;
        # 3% jitter must not read as 7 heights/s, while the rate floor stays the window.
        observations = rows(count=6)
        for i, row in enumerate(observations):
            row.update(pts=i, time_base=[1, 240])
            row.update(vars(person(offset=80 * .03 * (-1) ** i)))
        tracks, segments, events = split_tracks(observations)
        self.assertEqual((len(segments), events), (1, []))
        self.assertTrue(all(s["centre_jump_heights_per_s"] < 5 for s in tracks[0]["steps"]))

    def test_high_fps_half_height_centre_jump_splits(self):
        observations = rows(count=2)
        for i, row in enumerate(observations):
            row.update(pts=i, time_base=[1, 240])
            row.update(vars(person(offset=80 * .5 * i)))
        _, segments, events = split_tracks(observations)
        self.assertEqual(len(segments), 2)
        self.assertEqual(events[0]["reason_codes"], ["CENTRE_JUMP"])

    def test_nearby_swap_splits_at_30_and_240_fps(self):
        for fps in (30, 240):
            with self.subTest(fps=fps):
                observations = rows(count=24)
                for i, row in enumerate(observations):
                    row.update(pts=i, time_base=[1, fps])
                    row.update(vars(person(offset=80 * .2 if i >= 12 else 0)))
                tracks, segments, events = split_tracks(observations)
                self.assertEqual(len(segments), 2)
                self.assertEqual(events, [{"track_id": "1", "index": 12, "reason_codes": ["CENTRE_JUMP"]}])
                steps = {step["index"]: step for step in tracks[0]["steps"]}
                self.assertEqual(steps[12]["centre_reference_index"], 11 if fps == 30 else 4)
                self.assertAlmostEqual(steps[12]["centre_elapsed_s"], 1 / 30)
                # References restart at the split; never compare to the old identity.
                self.assertEqual(steps[13]["centre_reference_index"], 12)

    def test_nearby_swap_splits_on_millisecond_timebase_30fps(self):
        # Phone containers often use a 1/1000 time base: 30 fps alternates 33/34 ms ticks.
        # A 33 ms step must still compare with the immediately preceding frame.
        ticks = [round(i * 1000 / 30) for i in range(24)]
        for swap_at in (12, 14):  # 33 ms and 34 ms steps
            with self.subTest(step_ms=ticks[swap_at] - ticks[swap_at - 1]):
                observations = rows(count=24)
                for i, row in enumerate(observations):
                    row.update(pts=ticks[i], time_base=[1, 1000])
                    row.update(vars(person(offset=80 * .2 if i >= swap_at else 0)))
                tracks, _, events = split_tracks(observations)
                self.assertEqual(events, [{"track_id": "1", "index": swap_at, "reason_codes": ["CENTRE_JUMP"]}])
                steps = {step["index"]: step for step in tracks[0]["steps"]}
                self.assertEqual(steps[swap_at]["centre_reference_index"], swap_at - 1)

    def test_each_continuity_reason_and_selected_segment_boundary(self):
        for reason in ("SCALE_JUMP", "PROPORTION_SHIFT"):
            observations = rows()
            for row in observations[10:]:
                if reason == "SCALE_JUMP": row["box_xyxy"] = [0, 0, 160, 180]
                else: row["keypoints17"][6][0] += 60
            _, segments, events = split_tracks(observations)
            self.assertEqual(len(segments), 2)
            self.assertIn(reason, events[0]["reason_codes"])
        observations = rows(switch=True)
        for row in observations[10:]: row["keypoints17"][10][2] = 0
        _, segments, _ = split_tracks(observations)
        decision, _ = select_batter(segments)
        self.assertEqual(decision["status"], "selected")
        selected = next(s for s in segments if s["id"] == decision["segment_id"])
        self.assertEqual([r["index"] for r in selected["rows"]], list(range(10)))

    def test_decode_failure_artifacts_and_arbitrary_rotation(self):
        path = self.directory / "raw.mp4"
        fixture(path)
        out = self.directory / "limited"
        self.assertEqual(run(path, out, Double(), max_frames=2, device="cpu", bat_model=NoBat()), "analysis_unavailable")
        artifacts = {p.name: json.loads(p.read_text()) for p in out.glob("*.json")}
        validate(artifacts)
        self.assertEqual(artifacts["pipeline_status.json"]["detail"]["reason_codes"], ["CLIP_TOO_LONG"])
        self.assertTrue(all(f["keypoints"] is None for f in artifacts["pose_2d.json"]["frames"]))
        rotated = self.directory / "arbitrary.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-display_rotation:v:0", "0.5", "-i", str(path), "-c", "copy", str(rotated)], check=True)
        with self.assertRaisesRegex(Unavailable, "UNSUPPORTED_ROTATION"): list(decode(rotated, {}))
        broken = self.directory / "broken.bin"
        broken.write_bytes(b"not a container")
        with self.assertRaisesRegex(Unavailable, "DECODE_ERROR"): list(decode(broken, {}))
        audio = self.directory / "audio.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc", "-t", "0.1", str(audio)], check=True)
        with self.assertRaisesRegex(Unavailable, "NO_VIDEO_STREAM"): list(decode(audio, {}))

    def test_native_reid_fallback_is_refused_before_tracking(self):
        if not MODEL.exists(): self.skipTest("pose weights absent; never download")
        with patch("ultralytics.YOLO", return_value=SimpleNamespace(model=SimpleNamespace(model=[object()]))):
            with self.assertRaisesRegex(Unavailable, "REID_NATIVE_FEATURES_UNAVAILABLE"):
                YoloDetector()

    def test_artifacts_terminal_states_and_repeatability(self):
        path = self.directory / "raw.mp4"
        fixture(path)
        for mode, expected in (("selected", "complete"), ("ambiguous", "analysis_unavailable"),
                               ("empty", "analysis_unavailable"), ("no_grip", "analysis_unavailable"), ("crash", "crashed")):
            outputs = [self.directory / f"{mode}-{i}" for i in range(2)]
            for out in outputs:
                # Runtime provenance varies in production; freeze clocks, not analysis, for byte comparison.
                stderr = io.StringIO()
                with redirect_stderr(stderr):
                    self.assertEqual(run(path, out, Double(mode), device="cpu", bat_model=NoBat(), clock=lambda: 0.0,
                                         now=lambda: "2026-01-01T00:00:00Z"), expected)
                status = json.loads((out / "pipeline_status.json").read_text())
                self.assertEqual(status["status"], expected)
                if mode == "crash":
                    self.assertIn("Traceback (most recent call last):", stderr.getvalue())
                    self.assertIn("RuntimeError: synthetic crash", stderr.getvalue())
                    self.assertEqual(status["detail"], {"reason_codes": ["UNEXPECTED_EXCEPTION"],
                                                       "exception_type": "RuntimeError"})
                self.assertFalse((out / "pose_3d.json").exists())
                self.assertEqual((out / "bat_path.json").exists(), mode != "crash")
                if mode != "crash":
                    artifacts = {p.name: json.loads(p.read_text()) for p in out.glob("*.json")}
                    validate(artifacts)
                    if mode != "selected": self.assertTrue(all(f["keypoints"] is None for f in artifacts["pose_2d.json"]["frames"]))
            self.assertEqual({p.name: p.read_bytes() for p in outputs[0].glob("*.json")},
                             {p.name: p.read_bytes() for p in outputs[1].glob("*.json")})
        stale = outputs[0] / "pose_3d.json"
        stale.write_text("{}")
        run(path, outputs[0], Double("empty"), device="cpu", bat_model=NoBat())
        self.assertFalse(stale.exists())

    def test_real_model_person_free_cpu_offline(self):
        if not MODEL.exists(): self.skipTest("pose weights absent; never download")
        path = self.directory / "empty.mp4"
        fixture(path, count=6)
        with patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")), \
             patch("ultralytics.utils.downloads.safe_download", side_effect=AssertionError("download forbidden")):
            detector = YoloDetector("cpu")
            self.assertTrue(detector.native_reid)
            out = self.directory / "smoke"
            self.assertEqual(run(path, out, detector, device="cpu", bat_model=NoBat()), "analysis_unavailable")
            self.assertIn("NO_PERSON_DETECTED", json.loads((out / "pipeline_status.json").read_text())["detail"]["reason_codes"])
            tracker = detector.model.predictor.trackers[0]
            self.assertEqual(tracker.__class__.__name__, "BOTSORT")
            self.assertTrue(callable(tracker.encoder))


if __name__ == "__main__": unittest.main()
