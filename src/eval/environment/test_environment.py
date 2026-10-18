import copy
import hashlib
import json
import os
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import capture_environment as capture
import baseline_runner as runner


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((Path(__file__).parent / "models.lock.json").read_text(encoding="utf-8"))

    def test_safe_diagnostics(self):
        self.assertEqual(capture.safe_error_code(ValueError("EVAL_ROOT_UNCONFIGURED")), "EVAL_ROOT_UNCONFIGURED")
        self.assertEqual(capture.safe_error_code(ValueError("C:/private/secret")), "UNCLASSIFIED_FAILURE")
        self.assertEqual(capture.safe_error_code(OSError("C:/private/secret")), "UNCLASSIFIED_FAILURE")

    def test_deterministic_version(self):
        a = capture.environment_version("B==2\r\na_b==1\n", self.manifest)
        b = capture.environment_version("a-b==1\nb==2\n", dict(reversed(list(self.manifest.items()))))
        self.assertEqual(a, b)
        self.assertNotEqual(a, capture.environment_version("a-b==2\nb==2", self.manifest))
        changed = copy.deepcopy(self.manifest)
        changed["runtime"]["settings"]["cudnnBenchmark"] = not changed["runtime"]["settings"]["cudnnBenchmark"]
        self.assertNotEqual(a, capture.environment_version("a-b==1\nb==2", changed))

    def test_nonportable_freeze(self):
        for value in ["a @ file:///private/path", "-e secret", "a==1\na==1", ""]:
            with self.assertRaises(ValueError):
                capture.canonical_requirements(value)

    def test_missing_model(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, "MODEL_MISSING"):
                capture.verify_models(Path(folder), self.manifest)

    def test_hash_mismatch(self):
        with patch.object(capture, "file_identity", return_value={"bytes": 1, "sha256": "0" * 64}):
            with self.assertRaisesRegex(ValueError, "HASH_MISMATCH"):
                capture.verify_models(Path("."), self.manifest)

    def test_malformed_manifests(self):
        for mutate in [lambda m: m.update(extra=True), lambda m: m.update(schemaVersion=2), lambda m: m.update(schemaVersion=True),
                       lambda m: m.update(models={}), lambda m: m.update(videoPose3dCommit="HEAD"),
                       lambda m: m["runtime"].update(gpu="C:/private"),
                       lambda m: m["runtime"]["settings"].update(torchThreads=0),
                       lambda m: m["models"]["yolov8m.pt"].update(bytes=True)]:
            value = copy.deepcopy(self.manifest)
            mutate(value)
            with self.assertRaises(ValueError):
                capture.validate_manifest(value)

    def test_source_provenance(self):
        for mismatch in ["commit", "wrong-hash", ""]:
            with patch.object(runner, "command", return_value=mismatch):
                with self.assertRaisesRegex(ValueError, "PROVENANCE"):
                    runner.verify_source(Path("."))

    def test_output_isolation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            repo = root / "repo"
            repo.mkdir()
            inside = repo / "eval"
            inside.mkdir()
            private = root / "private"
            private.mkdir()
            self.assertEqual(runner.isolated_root(private, [repo]), private.resolve())
            for path in [repo, inside, root]:
                with self.assertRaises(ValueError):
                    runner.isolated_root(path, [repo])
            (private / ".git").mkdir()
            with self.assertRaises(ValueError):
                runner.isolated_root(private, [repo])

    def test_authorization_before_any_process(self):
        with patch.object(runner, "verify_source") as verify:
            with self.assertRaises(ValueError):
                runner.run(Path('.'), Path('.'), Path('.'), Path('.'), '', {}, False, True)
            verify.assert_not_called()


class EnvironmentBoundaryTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    environment = Path(__file__).resolve().parent
    probe_python = root / ".venv_pose3d" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

    def test_capture_and_lock_copies(self):
        instrumentation = self.root / "scripts/pose3d/instrumentation"
        original = (self.environment / "capture_environment.py").read_bytes().replace(b"\r\n", b"\n")
        observer = (instrumentation / "capture_environment_v1.py").read_bytes().replace(b"\r\n", b"\n")
        self.assertEqual(original, observer)
        for name in ["requirements.lock.txt", "models.lock.json"]:
            with self.subTest(lock=name):
                self.assertEqual((self.environment / name).read_bytes(), (instrumentation / name).read_bytes())

    def test_lock_registry_identity(self):
        pins = (self.environment / "requirements.lock.txt").read_text(encoding="utf-8")
        manifest = json.loads((self.environment / "models.lock.json").read_text(encoding="utf-8"))
        self.assertEqual(capture.environment_version(pins, manifest), "env-f4ad5b330d0c")
        registry = (self.root / "src/services/development/evidenceRegistry.ts").read_text(encoding="utf-8")
        self.assertRegex(registry, r"environmentVersion:\s*['\"]env-f4ad5b330d0c['\"]")

    def test_import_boundary_identity_model(self):
        pins = (self.environment / "requirements.lock.txt").read_text(encoding="utf-8")
        manifest = json.loads((self.environment / "models.lock.json").read_text(encoding="utf-8"))
        original = copy.deepcopy(manifest)
        changed = copy.deepcopy(manifest)
        changed["runtime"]["settings"].update(OMP_NUM_THREADS="1", torchThreads=1)
        approved = capture.environment_version(pins, manifest)
        inherited = capture.environment_version(pins, changed)
        self.assertEqual(approved, "env-f4ad5b330d0c")
        self.assertEqual(inherited, "env-9a6a8510dec8")
        self.assertNotEqual(approved, inherited)
        singles = []
        for key, value in [("OMP_NUM_THREADS", "1"), ("torchThreads", 1)]:
            single = copy.deepcopy(manifest)
            single["runtime"]["settings"][key] = value
            identity = capture.environment_version(pins, single)
            self.assertNotIn(identity, [approved, inherited])
            singles.append(identity)
        self.assertNotEqual(*singles)
        self.assertEqual(manifest, original)


    def test_additive_runtime_lock_identity_and_immutability(self):
        runtime = self.environment / "locks/env-9a6a8510dec8"
        requirements_hash = "4be180910788d1c43088b08f896457c05e59c8a0f8998a0a9e974807222a82d6"
        original_hash = "05e1153fdbd6c6417ae505152e4b9a3604514b5d2ad8f61b80491fd4b840b33d"
        runtime_hash = "15a970e7af4833a3da2988c670ecf3eb89e099f9ee200bf76f5b2f3fa0affaf8"
        for directory, model_hash in [(self.environment, original_hash),
                                      (self.root / "scripts/pose3d/instrumentation", original_hash),
                                      (runtime, runtime_hash)]:
            for name, expected in [("requirements.lock.txt", requirements_hash), ("models.lock.json", model_hash)]:
                with self.subTest(directory=directory, lock=name):
                    self.assertEqual(hashlib.sha256((directory / name).read_bytes()).hexdigest(), expected)
        self.assertEqual((runtime / "requirements.lock.txt").read_bytes(),
                         (self.environment / "requirements.lock.txt").read_bytes())
        pins = (runtime / "requirements.lock.txt").read_text(encoding="utf-8")
        original = json.loads((self.environment / "models.lock.json").read_text(encoding="utf-8"))
        observed = json.loads((runtime / "models.lock.json").read_text(encoding="utf-8"))
        self.assertEqual(capture.validate_manifest(observed), observed)
        self.assertEqual(capture.environment_version(pins, original), "env-f4ad5b330d0c")
        self.assertEqual(capture.environment_version(pins, observed), "env-9a6a8510dec8")
        self.assertEqual(original["models"], observed["models"])
        self.assertIsNone(original["runtime"]["settings"]["OMP_NUM_THREADS"])
        self.assertEqual(original["runtime"]["settings"]["torchThreads"], 8)
        expected = copy.deepcopy(original)
        expected["runtime"]["settings"].update(OMP_NUM_THREADS="1", torchThreads=1)
        self.assertEqual(observed, expected)
        registry = (self.root / "src/services/development/evidenceRegistry.ts").read_text(encoding="utf-8")
        for identity in ["env-f4ad5b330d0c", "env-9a6a8510dec8"]:
            self.assertIn(identity, registry)

    @unittest.skipUnless(probe_python.is_file(), "pose3d virtualenv Python unavailable")
    def test_real_runtime_capture_identity(self):
        code = ("import sys; from pathlib import Path; root=Path(sys.argv[1]); "
                "sys.path.insert(0,str(root/'src/eval/environment')); "
                "import ultralytics; from capture_environment import capture,environment_version; "
                "requirements,manifest=capture(root); "
                "print('IDENTITY=' + environment_version(requirements,manifest))")
        with tempfile.TemporaryDirectory() as folder:
            env = dict(os.environ)
            env.pop("OMP_NUM_THREADS", None)
            env.update(PYTHONDONTWRITEBYTECODE="1", YOLO_CONFIG_DIR=folder)
            result = subprocess.run([str(self.probe_python), "-B", "-c", code, str(self.root)],
                                    env=env, capture_output=True, text=True, timeout=300, check=True)
            identities = [line.removeprefix("IDENTITY=") for line in result.stdout.splitlines()
                          if line.startswith("IDENTITY=")]
            self.assertEqual(identities, ["env-9a6a8510dec8"])

    @unittest.skipUnless(probe_python.is_file(), "pose3d virtualenv Python unavailable")
    def test_real_import_boundary(self):
        code = ("import os, json; before = os.environ.get('OMP_NUM_THREADS'); "
                "import ultralytics; print('BOUNDARY=' + json.dumps([before, os.environ.get('OMP_NUM_THREADS')]))")
        for preset, expected in [(None, [None, "1"]), ("4", ["4", "4"])]:
            with self.subTest(preset=preset), tempfile.TemporaryDirectory() as folder:
                env = dict(os.environ)
                env.pop("OMP_NUM_THREADS", None)
                if preset is not None:
                    env["OMP_NUM_THREADS"] = preset
                env.update(PYTHONDONTWRITEBYTECODE="1", YOLO_CONFIG_DIR=folder)
                result = subprocess.run([str(self.probe_python), "-B", "-c", code], env=env,
                                        capture_output=True, text=True, timeout=180, check=True)
                lines = [line.removeprefix("BOUNDARY=") for line in result.stdout.splitlines() if line.startswith("BOUNDARY=")]
                self.assertEqual(len(lines), 1)
                self.assertEqual(json.loads(lines[0]), expected)


if __name__ == "__main__":
    unittest.main()
