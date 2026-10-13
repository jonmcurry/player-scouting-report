"""Read-only runtime capture; no model loading, installations or downloads.

Only portable name==version freeze entries may leave this process. Direct URLs,
editable installs and local paths fail closed rather than producing a false lock.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys

MODELS = {
    "yolo11m-pose.pt": "scripts/models/yolo11m-pose.pt",
    "yolov8m.pt": "scripts/models/yolov8m.pt",
    "pretrained_h36m_detectron_coco.bin": ".venv_pose3d/VideoPose3D_src/checkpoint/pretrained_h36m_detectron_coco.bin",
}

# Only our fixed codes may reach a public console. Arbitrary exception text never does.
SAFE_ERROR_CODES = frozenset("""
CAPTURE_COMMAND_FAILED NONPORTABLE_PACKAGE_ENTRY DUPLICATE_PACKAGE EMPTY_REQUIREMENTS
MODEL_MISSING MODEL_EMPTY MANIFEST_SCHEMA MANIFEST_PROVENANCE MANIFEST_MODELS
MANIFEST_MODEL_SCHEMA MANIFEST_RUNTIME MANIFEST_RUNTIME_VALUE MANIFEST_SETTINGS
MANIFEST_SETTINGS_TYPE NONPORTABLE_RUNTIME_SETTING MODEL_HASH_MISMATCH
VIDEOPOSE3D_DIRTY VIDEOPOSE3D_EXTRA_SOURCE CAPTURE_ALREADY_EXISTS
SOURCE_PROVENANCE_MISMATCH SOURCE_NOT_DETACHED SOURCE_DIRTY SOURCE_LINK SOURCE_EXTRA_FILES
EVAL_ROOT_MUST_EXIST OUTPUT_NOT_ISOLATED OUTPUT_INSIDE_GIT
LOCAL_AUTHORIZATION_AND_OFFLINE_HOST_REQUIRED SOURCE_NOT_ISOLATED
INPUT_NOT_PRIVATE_EVALUATION_COPY ENVIRONMENT_MISMATCH OUTPUT_LINK_ESCAPE
INPUT_CHANGED PIPELINE_FAILED EVAL_ROOT_UNCONFIGURED
""".split())


def safe_error_code(error):
    return str(error) if isinstance(error, ValueError) and str(error) in SAFE_ERROR_CODES else "UNCLASSIFIED_FAILURE"


def command(args, cwd=None):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                            timeout=120, env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"})
    if result.returncode:
        raise ValueError("CAPTURE_COMMAND_FAILED")
    return result.stdout.strip()


def canonical_requirements(text):
    entries = {}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        match = re.fullmatch(r"([A-Za-z0-9][A-Za-z0-9_.-]*)==([A-Za-z0-9][A-Za-z0-9.!+_-]*)", line)
        if not match:
            raise ValueError("NONPORTABLE_PACKAGE_ENTRY")
        name = re.sub(r"[-_.]+", "-", match[1]).lower()
        if name in entries:
            raise ValueError("DUPLICATE_PACKAGE")
        entries[name] = match[2]
    if not entries:
        raise ValueError("EMPTY_REQUIREMENTS")
    return "".join(f"{name}=={entries[name]}\n" for name in sorted(entries))


def file_identity(path):
    if not path.is_file():
        raise ValueError("MODEL_MISSING")
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
            size += len(block)
    if not size:
        raise ValueError("MODEL_EMPTY")
    return {"sha256": digest.hexdigest(), "bytes": size}


def validate_manifest(value):
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "runtime", "videoPose3dCommit", "models"}:
        raise ValueError("MANIFEST_SCHEMA")
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1 or not re.fullmatch(r"[0-9a-f]{40}", str(value["videoPose3dCommit"])):
        raise ValueError("MANIFEST_PROVENANCE")
    if not isinstance(value["models"], dict) or set(value["models"]) != set(MODELS):
        raise ValueError("MANIFEST_MODELS")
    for entry in value["models"].values():
        if (not isinstance(entry, dict) or set(entry) != {"sha256", "bytes"}
                or not re.fullmatch(r"[0-9a-f]{64}", str(entry["sha256"]))
                or type(entry["bytes"]) is not int or entry["bytes"] <= 0):
            raise ValueError("MANIFEST_MODEL_SCHEMA")
    runtime = value["runtime"]
    keys = {"python", "torch", "cuda", "cudnn", "ultralytics", "opencv", "ffmpeg",
            "os", "architecture", "gpu", "driver", "settings"}
    if not isinstance(runtime, dict) or set(runtime) != keys:
        raise ValueError("MANIFEST_RUNTIME")
    for key in keys - {"settings"}:
        item = runtime[key]
        if not isinstance(item, str) or not re.fullmatch(r"[A-Za-z0-9 ._+(),=-]{1,160}", item):
            raise ValueError("MANIFEST_RUNTIME_VALUE")
    settings = runtime["settings"]
    bool_keys = {"cudaAvailable", "cudnnBenchmark", "cudnnDeterministic", "deterministicAlgorithms", "tf32Matmul", "tf32Cudnn"}
    int_keys = {"torchThreads", "torchInteropThreads"}
    env_keys = {"CUBLAS_WORKSPACE_CONFIG", "CUDA_VISIBLE_DEVICES", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "PYTHONHASHSEED"}
    if not isinstance(settings, dict) or set(settings) != bool_keys | int_keys | env_keys:
        raise ValueError("MANIFEST_SETTINGS")
    if any(type(settings[k]) is not bool for k in bool_keys) or any(type(settings[k]) is not int or settings[k] < 1 for k in int_keys):
        raise ValueError("MANIFEST_SETTINGS_TYPE")
    for key in env_keys:
        if settings[key] is not None and (not isinstance(settings[key], str) or not re.fullmatch(r"[0-9,:-]{1,64}|random", settings[key])):
            raise ValueError("NONPORTABLE_RUNTIME_SETTING")
    return value


def environment_version(requirements, manifest):
    validate_manifest(manifest)
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"), allow_nan=False)
    payload = canonical_requirements(requirements) + "\0" + canonical
    return "env-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def verify_models(root, manifest):
    validate_manifest(manifest)
    for name, relative in MODELS.items():
        if file_identity(root / relative) != manifest["models"][name]:
            raise ValueError("MODEL_HASH_MISMATCH")


def capture(root):
    # Freeze first: metadata only, no import-time third-party side effects.
    requirements = canonical_requirements(command([sys.executable, "-m", "pip", "freeze", "--all", "--disable-pip-version-check"]))
    research = root / ".venv_pose3d/VideoPose3D_src"
    commit = command(["git", "rev-parse", "HEAD"], research)
    if command(["git", "diff", "HEAD", "--name-only"], research):
        raise ValueError("VIDEOPOSE3D_DIRTY")
    extra = command(["git", "ls-files", "--others"], research).splitlines()
    if any(p != "checkpoint/pretrained_h36m_detectron_coco.bin" and not
           ("__pycache__/" in p and p.endswith(".pyc")) for p in extra):
        raise ValueError("VIDEOPOSE3D_EXTRA_SOURCE")
    models = {name: file_identity(root / relative) for name, relative in MODELS.items()}
    import torch
    import cv2
    # Do not import ultralytics: its import may create user configuration.
    version = importlib.metadata.version
    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none"
    driver = command(["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"])
    ffmpeg = command(["ffmpeg", "-version"]).splitlines()[0].split(" Copyright")[0]
    settings = {
        "cudaAvailable": torch.cuda.is_available(), "cudnnBenchmark": torch.backends.cudnn.benchmark,
        "cudnnDeterministic": torch.backends.cudnn.deterministic,
        "deterministicAlgorithms": torch.are_deterministic_algorithms_enabled(),
        "tf32Matmul": torch.backends.cuda.matmul.allow_tf32, "tf32Cudnn": torch.backends.cudnn.allow_tf32,
        "torchThreads": torch.get_num_threads(), "torchInteropThreads": torch.get_num_interop_threads(),
        **{key: os.environ.get(key) for key in ["CUBLAS_WORKSPACE_CONFIG", "CUDA_VISIBLE_DEVICES", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "PYTHONHASHSEED"]},
    }
    manifest = {"schemaVersion": 1, "videoPose3dCommit": commit, "models": models, "runtime": {
        "python": platform.python_version(), "torch": version("torch"), "cuda": str(torch.version.cuda),
        "cudnn": str(torch.backends.cudnn.version()), "ultralytics": version("ultralytics"), "opencv": cv2.__version__,
        "ffmpeg": ffmpeg, "os": platform.system() + " " + platform.release() + " " + platform.version(),
        "architecture": platform.machine(), "gpu": gpu, "driver": driver, "settings": settings,
    }}
    validate_manifest(manifest)
    return requirements, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    requirements, manifest = capture(args.source.resolve())
    # Exclusive files prevent accidentally replacing a prior capture.
    args.output.mkdir(parents=True, exist_ok=True)
    for name in ["requirements.lock.txt", "models.lock.json"]:
        if (args.output / name).exists():
            raise ValueError("CAPTURE_ALREADY_EXISTS")
    with (args.output / "requirements.lock.txt").open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(requirements)
    with (args.output / "models.lock.json").open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(manifest, sort_keys=True, indent=2, allow_nan=False) + "\n")
    print(environment_version(requirements, manifest))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never echo exception strings: subprocess and filesystem errors contain paths.
        print("Environment capture failed: " + safe_error_code(error), file=sys.stderr)
        sys.exit(1)
