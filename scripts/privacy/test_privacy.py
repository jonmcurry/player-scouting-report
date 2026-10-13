"""Regression tests for scripts/privacy/anonymize_clip.py.

Run: .venv_pose3d/Scripts/python.exe -m unittest scripts/privacy/test_privacy.py
(needs the pose3d venv: cv2, numpy, ultralytics + scripts/models/pr5-baseline-recovery/*.pt).
Uses only synthetic video - never real footage.
"""
import json, math, pathlib, subprocess, sys, tempfile, unittest

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import anonymize_clip as ac  # noqa: E402
import audit_subject
import compare_torso_pose
import validate_privacy


class CheckpointPaths(unittest.TestCase):
    def test_all_offline_loaders_use_relocated_checkpoints(self):
        root = pathlib.Path(__file__).resolve().parents[1] / "models" / "pr5-baseline-recovery"
        for actual, name in ((ac.MODEL, "yolo11m-pose.pt"),
                             (ac.MODEL2, "yolov8m.pt"),
                             (ac.SEG_MODEL, "yolo11m-seg.pt"),
                             (audit_subject.MODEL, "yolo11m-pose.pt"),
                             (compare_torso_pose.MODEL, "yolo11m-pose.pt"),
                             (validate_privacy.HERE / "yolov8m.pt", "yolov8m.pt"),
                             (validate_privacy.HERE / "yolo11m-pose.pt", "yolo11m-pose.pt")):
            with self.subTest(loader=str(actual), checkpoint=name):
                self.assertEqual(actual, root / name)

    def test_relocated_checkpoints_are_git_ignored(self):
        repo = pathlib.Path(__file__).resolve().parents[2]
        for name in ("yolo11m-pose.pt", "yolo11m-seg.pt", "yolov8m.pt"):
            path = "scripts/models/pr5-baseline-recovery/" + name
            result = subprocess.run(["git", "check-ignore", "--quiet", "--", path], cwd=repo)
            self.assertEqual(result.returncode, 0, path)


def person(cx, cy, h, conf=0.9):
    """COCO-17 keypoints for an upright figure centred at (cx, cy), height h."""
    u = h / 8
    pts = [(0, -3.6), (-0.2, -3.8), (0.2, -3.8), (-0.4, -3.6), (0.4, -3.6), (-1, -2.6), (1, -2.6), (-1.3, -1.4), (1.3, -1.4),
           (-1.2, -0.3), (1.2, -0.3), (-0.6, 0), (0.6, 0), (-0.7, 2), (0.7, 2), (-0.7, 4), (0.7, 4)]
    return [[cx + x * u, cy + y * u, conf] for x, y in pts]


def pose_doc(frames):
    return {"meta": {"fps": 29.87, "width": 1280, "height": 720, "n_frames": len(frames)},
            "frames": [{"frame": i, "time_s": i / 29.87, "keypoints": k} for i, k in enumerate(frames)]}


class IdentityBreak(unittest.TestCase):
    def test_smooth_track_has_no_break(self):
        self.assertIsNone(ac.identity_break(pose_doc([person(400 + i, 400, 240) for i in range(60)])))

    def test_scale_jump_is_a_switch(self):
        frames = [person(400, 400, 240) for _ in range(30)] + [person(900, 300, 110) for _ in range(30)]
        self.assertEqual(ac.identity_break(pose_doc(frames)), 30)

    def test_centre_jump_is_a_switch(self):
        frames = [person(300, 400, 240) for _ in range(20)] + [person(900, 400, 240) for _ in range(20)]
        self.assertEqual(ac.identity_break(pose_doc(frames)), 20)

    def test_unreliable_frames_do_not_hide_a_switch(self):
        blank = [[0, 0, 0.0]] * 17
        frames = [person(400, 400, 240)] * 10 + [blank] * 3 + [person(1000, 350, 100)] * 10
        self.assertEqual(ac.identity_break(pose_doc(frames)), 13)


class Masks(unittest.TestCase):
    def test_keep_region_is_the_subject_and_bat_only(self):
        kps = person(400, 400, 240)
        tight, keep, reliable, body_h = ac.subject_masks(kps, ((520, 330), (640, 200)), (720, 1280))
        self.assertGreaterEqual(reliable, ac.MIN_RELIABLE_KPS)
        self.assertTrue(keep[400, 400] > 0 and keep[250, 600] > 0)      # body, bat
        self.assertTrue(tight[400, 400] > 0 and tight[250, 600] == 0)    # the bat is NOT in the tight body mask
        self.assertEqual(keep[400, 1100], 0)                            # far background never kept
        self.assertEqual(keep[100, 100], 0)
        # A bystander beside the bat tip is obscured: only the tight BODY survives other-person masks.
        other = np.zeros_like(keep); cv2.rectangle(other, (600, 150), (700, 330), 255, -1)
        visible = cv2.bitwise_and(keep, cv2.bitwise_not(cv2.bitwise_and(other, cv2.bitwise_not(tight))))
        self.assertEqual(visible[250, 640], 0)

    def test_too_few_reliable_joints_keeps_nothing(self):
        kps = person(400, 400, 240, conf=0.1)
        _, keep, reliable, _ = ac.subject_masks(kps, None, (720, 1280))
        self.assertLess(reliable, ac.MIN_RELIABLE_KPS)
        self.assertEqual(int(keep.max()), 0)

    def test_jersey_band_covers_upper_torso_not_head_legs_or_bat_outside_it(self):
        kps = person(400, 400, 240)          # shoulders y=322, hips y=400, elbows (361|439, 358), head ~y 290
        bat = ((436, 391), (560, 260))
        m, method = ac.jersey_mask(kps, bat, 240, (720, 1280))
        self.assertEqual(method, "torso")
        self.assertTrue(m[345, 400] > 0 and m[330, 400] > 0)            # chest / name-bar area masked
        self.assertTrue(m[358, 361] > 0)                                 # an elbow OVER the band is masked (no limb carve-outs:
                                                                         # misaligned limb lines exposed lettering on real footage)
        self.assertEqual(m[290, 400], 0)                                 # head stays visible
        self.assertEqual(m[460, 400], 0)                                 # legs stay visible
        self.assertEqual(m[int(391 + (260 - 391) * 0.2), int(436 + (560 - 436) * 0.2)], 0)  # bat stays visible
        self.assertLess(int((m > 0).sum()), 0.08 * 240 * 240 * 4)        # a band, not the whole figure

    def test_jersey_band_follows_a_rotated_torso(self):
        # Same figure lying sideways (a deep follow-through lean): the band must follow the shoulder->hip axis.
        kps = [[400 + (y - 400), 400 - (x - 400), c] for x, y, c in person(400, 400, 240)]
        m, method = ac.jersey_mask(kps, None, 240, (720, 1280))
        self.assertEqual(method, "torso")
        self.assertTrue(m[400, 345] > 0)                                  # rotated chest
        self.assertEqual(m[345, 400], 0)                                  # where an upright chest would be

    def test_helmet_shell_masked_face_window_kept(self):
        kps = person(400, 400, 240)          # eyes (394|406, 286), ears (388|412, 292)
        kps[0] = [430, 292, 0.9]              # nose, facing +x
        m, mode = ac.helmet_mask(kps, 240, (720, 1280))
        self.assertEqual(mode, "face_window")
        self.assertTrue(m[285, 375] > 0)                                 # back of helmet (surname decal)
        self.assertTrue(m[270, 420] > 0)                                 # front of shell above the brim (team wordmark)
        self.assertEqual(m[292, 425], 0)                                 # face below the brim stays visible

    def test_helmet_fully_masked_when_turned_away(self):
        kps = person(400, 400, 240)
        kps[0][2] = 0.1                       # no nose: facing away from the camera
        m, mode = ac.helmet_mask(kps, 240, (720, 1280))
        self.assertEqual(mode, "full")
        self.assertTrue(m[285, 375] > 0 and m[285, 425] > 0)

    def test_jersey_band_without_shoulders_uses_flagged_fallback(self):
        kps = person(400, 400, 240)
        kps[5][2] = kps[6][2] = 0.1
        m, method = ac.jersey_mask(kps, None, 240, (720, 1280))
        self.assertEqual(method, "fallback")
        self.assertGreater(int(m.max()), 0)

    def test_precise_candidates_are_strokes_not_flat_bright_areas(self):
        img = np.full((200, 400, 3), (90, 40, 20), np.uint8)           # navy jersey (BGR)
        cv2.putText(img, "PLAYER", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (235, 235, 235), 2)
        cv2.rectangle(img, (250, 120), (390, 190), (230, 230, 230), -1)  # a wide flat bright panel (sky/side panel)
        zone = np.full((200, 400), 255, np.uint8)
        c = ac.letter_candidates(img, zone, 200)
        self.assertGreater(int((c[50:90, 20:200] > 0).sum()), 50)       # the lettering strokes
        self.assertLess(int((c[135:175, 265:375] > 0).sum()), 20)       # not the inside of the flat panel
        comps = ac.letter_components(c, 200)
        words = [h for h, k in comps if k == "word"]
        self.assertTrue(words)
        m = np.zeros((200, 400), np.uint8)
        for h in words:
            cv2.fillConvexPoly(m, h.reshape(-1, 2), 255)
        self.assertGreater(m[65, 60], 0)                                 # filled outline, not just strokes

    def test_precise_drops_long_thin_piping(self):
        c = np.zeros((300, 300), np.uint8)
        cv2.line(c, (20, 50), (280, 60), 255, 1)                         # piping: 260 px long, 1 px thin
        kinds = [k for _, k in ac.letter_components(c, 250)]
        self.assertEqual(kinds, ["line"])

    def test_precise_mask_unions_neighbours_shifted_with_the_torso(self):
        hull = np.array([[[100, 100]], [[120, 100]], [[120, 110]], [[100, 110]]], np.int32)
        pre = {0: {"hulls": [hull], "anchor": (100.0, 100.0), "status": "ok", "body_h": 200},
               1: {"hulls": [], "anchor": (110.0, 100.0), "status": "ok", "body_h": 200}}   # frame 1: detection missed
        m = ac.precise_mask(pre, 1, (300, 300))
        self.assertGreater(m[105, 125], 0)                               # frame 0's word, moved +10 px with the torso

    def test_confirmed_number_is_carved_out_but_nothing_around_it(self):
        num = np.array([[[100, 100]], [[130, 100]], [[130, 140]], [[100, 140]]], np.int32)
        word = np.array([[[90, 60]], [[170, 60]], [[170, 90]], [[90, 90]]], np.int32)      # the name, just above
        pre = {0: {"hulls": [num.copy(), word.copy()], "anchor": (100.0, 100.0), "status": "ok", "body_h": 200},
               1: {"hulls": [num.copy(), word.copy()], "anchor": (100.0, 100.0), "status": "ok", "body_h": 200}}
        # frame 1 confirmed its number (index 0); frame 0 did not
        m = ac.precise_mask(pre, 1, (300, 300), exempt={1: {0}})
        self.assertEqual(m[120, 115], 0)          # the number stays visible although frame 0's copy covers it
        self.assertGreater(m[75, 130], 0)         # the name above stays masked
        self.assertGreater(m[92, 115], 0)         # the name's padding (4 px here) outside the number outline stays masked
        m0 = ac.precise_mask(pre, 0, (300, 300), exempt={1: {0}})
        self.assertGreater(m0[120, 115], 0)       # frame 0 (unconfirmed) keeps its number masked

    def test_obscure_destroys_detail(self):
        rng = np.random.default_rng(1)
        img = (rng.random((360, 640, 3)) * 255).astype(np.uint8)
        cv2.putText(img, "PLAYER 00", (60, 200), cv2.FONT_HERSHEY_SIMPLEX, 3, (255, 255, 255), 8)
        lap = lambda x: cv2.Laplacian(cv2.cvtColor(x, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
        self.assertLess(lap(ac.obscure(img)) / lap(img), 0.01)


class EndToEnd(unittest.TestCase):
    def test_frames_timing_and_masking_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d); n, fps = 45, 29.87
            vid = d / "src.mp4"
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size=1280x720:rate={fps}",
                            "-frames:v", str(n), "-c:v", "libx264", "-pix_fmt", "yuv420p", str(vid)], check=True)
            json.dump(pose_doc([person(400, 400, 240)] * n), open(d / "pose.json", "w"))
            json.dump({"frames": [{"frame": i, "tip": [640, 200], "knob": [520, 330]} for i in range(n)]}, open(d / "bat.json", "w"))
            json.dump({"phases": {"load": {"time_s": 0.3}, "contact": {"time_s": 0.8}, "follow-through": {"time_s": 1.0}}}, open(d / "metrics.json", "w"))
            subprocess.run([sys.executable, str(pathlib.Path(ac.__file__)), "--video", str(vid), "--pose2d", str(d / "pose.json"), "--bat", str(d / "bat.json"),
                            "--metrics", str(d / "metrics.json"), "--out-dir", str(d), "--name", "t"], check=True, capture_output=True)
            summary = json.load(open(d / "t.summary.json"))
            self.assertEqual(summary["frames"], n)
            self.assertEqual(summary["analysis_frames"], n)
            probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-print_format", "json", "-show_streams", str(d / "t.mp4")],
                                              capture_output=True, text=True).stdout)["streams"][0]
            num, den = map(float, probe["avg_frame_rate"].split("/"))
            self.assertEqual(int(probe["nb_read_frames"]), n)
            self.assertAlmostEqual(num / den, fps, places=3)
            src, out = cv2.VideoCapture(str(vid)), cv2.VideoCapture(str(d / "t.mp4"))
            _, a = src.read(); _, b = out.read()
            src.release(); out.release()   # Windows: release file handles before the temp dir is removed
            diff = np.abs(a.astype(int) - b.astype(int)).max(axis=2)
            self.assertLess(diff[400, 400], 40)          # the subject's pixels are kept (up to codec noise)
            lap = lambda x: cv2.Laplacian(cv2.cvtColor(x, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
            self.assertLess(lap(b[100:300, 900:1200]) / lap(a[100:300, 900:1200]), 0.05)   # everything else: detail destroyed
            log = json.load(open(d / "t.frames.json"))
            self.assertEqual([r["frame"] for r in log], list(range(n)))   # every frame, in order - none skipped


if __name__ == "__main__":
    unittest.main()
