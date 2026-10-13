import copy
import json
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


if __name__ == "__main__":
    unittest.main()
