"""Isolated read-only runtime capture; never imports evaluation tooling."""
import json
from pathlib import Path
import capture_environment_v1 as capture


def collect():
    here = Path(__file__).resolve().parent
    root = here.parents[2]
    lock = json.loads((here / "models.lock.json").read_text(encoding="utf-8"))
    pins = (here / "requirements.lock.txt").read_text(encoding="utf-8")
    expected = capture.environment_version(pins, lock)
    reasons = []
    integrity = {}
    for name, path in capture.MODELS.items():
        try:
            actual = capture.file_identity(root / path)
            good = actual == lock["models"][name]
            integrity[name] = {"status": "verified" if good else "mismatch", **actual}
        except Exception:
            good = False
            integrity[name] = {"status": "unavailable"}
        if not good:
            reasons.append("MODEL_INTEGRITY_FAILED")
    version = None
    runtime_status = "unverified"
    try:
        requirements, manifest = capture.capture(root)
        version = capture.environment_version(requirements, manifest)
        # Inherited model-library initialization is NOT silently reset to match locks.
        runtime_status = "verified" if version == expected else "different_from_capture"
        if version != expected:
            reasons.append("ENVIRONMENT_DIFFERS_FROM_CAPTURE")
    except Exception:
        reasons.append("ENVIRONMENT_CAPTURE_FAILED")
    return {"environment_version": version, "environment_verification": runtime_status,
            "environment_capture_scope": "isolated_process_with_inherited_environment_after_engine_imports",
            "model_integrity": integrity, "provenance_reasons": sorted(set(reasons))}


if __name__ == "__main__":
    try:
        print(json.dumps(collect(), allow_nan=False))
    except Exception:
        print('{"environment_version":null,"model_integrity":null,"provenance_reasons":["PROVENANCE_FAILED"]}')
