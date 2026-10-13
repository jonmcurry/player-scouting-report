"""Offline, local-only baseline runner for an already provisioned detached checkout.

No worktree creation, installation, network isolation setup or consent inference.
Operator must first enforce OS-level network denial and approve local evaluation.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

from capture_environment import capture, command, environment_version, file_identity, verify_models, safe_error_code

COMMIT = "f79b09e63092e87efd1250c3b263d29086d81a79"
TREE = "766f4fbc64620d428da428e59b144554ca2f2a7b"
TAG = "engine-baseline-1.0.0"


def verify_source(source):
    checks = [(["cat-file", "-t", "refs/tags/" + TAG], "tag"),
              (["rev-parse", TAG + "^{commit}"], COMMIT),
              (["rev-parse", "HEAD"], COMMIT),
              (["rev-parse", "HEAD:scripts/pose3d"], TREE)]
    for args, expected in checks:
        if command(["git", *args], source) != expected:
            raise ValueError("SOURCE_PROVENANCE_MISMATCH")
    detached = subprocess.run(["git", "symbolic-ref", "-q", "HEAD"], cwd=source, capture_output=True)
    if detached.returncode != 1:
        raise ValueError("SOURCE_NOT_DETACHED")
    if command(["git", "diff", "HEAD", "--name-only"], source):
        raise ValueError("SOURCE_DIRTY")
    # Include ignored source: .gitignore cannot hide an injected Python module.
    expected = set(command(["git", "ls-tree", "-r", "--name-only", "HEAD", "scripts/pose3d"], source).splitlines())
    actual = set()
    for path in (source / "scripts/pose3d").rglob("*"):
        if path.is_symlink():
            raise ValueError("SOURCE_LINK")
        if path.is_file() and not (path.suffix == ".pyc" and path.parent.name == "__pycache__"):
            actual.add(path.relative_to(source).as_posix())
    if actual != expected:
        raise ValueError("SOURCE_EXTRA_FILES")


def isolated_root(root, repositories, production_roots=()):
    if not root.is_absolute() or not root.is_dir():
        raise ValueError("EVAL_ROOT_MUST_EXIST")
    root = root.resolve(strict=True)
    for forbidden in [*repositories, *production_roots]:
        forbidden = forbidden.resolve(strict=True)
        if root == forbidden or root in forbidden.parents or forbidden in root.parents:
            raise ValueError("OUTPUT_NOT_ISOLATED")
    # A different Git repository is not a private evaluation directory either.
    if any((parent / ".git").exists() for parent in [root, *root.parents]):
        raise ValueError("OUTPUT_INSIDE_GIT")
    return root


def run(source, repository, root, video, requirements, manifest, authorized, offline):
    if not authorized or not offline:
        raise ValueError("LOCAL_AUTHORIZATION_AND_OFFLINE_HOST_REQUIRED")
    source, repository, video = source.resolve(strict=True), repository.resolve(strict=True), video.resolve(strict=True)
    if source == repository:
        raise ValueError("SOURCE_NOT_ISOLATED")
    root = isolated_root(root, [source, repository])
    # Accept only evaluation copies already inside the approved private root.
    if root not in video.parents or not video.is_file():
        raise ValueError("INPUT_NOT_PRIVATE_EVALUATION_COPY")
    verify_source(source)
    verify_models(source, manifest)
    actual_requirements, actual_manifest = capture(source)
    version = environment_version(requirements, manifest)
    if environment_version(actual_requirements, actual_manifest) != version:
        raise ValueError("ENVIRONMENT_MISMATCH")
    identity = file_identity(video)
    parent = root / "golden" / TAG / version / identity["sha256"]
    # Check every existing ancestor before creating anything through it.
    for ancestor in [parent, *parent.parents]:
        if ancestor == root:
            break
        if ancestor.exists() and root not in ancestor.resolve().parents:
            raise ValueError("OUTPUT_LINK_ESCAPE")
    parent.mkdir(parents=True, exist_ok=True)
    if root not in parent.resolve().parents:
        raise ValueError("OUTPUT_LINK_ESCAPE")
    output = parent / ("run-" + uuid4().hex)
    output.mkdir(exist_ok=False)
    # Only OS runtime essentials, never provider credentials or PYTHONPATH.
    allowed = {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"}
    env = {k: v for k, v in os.environ.items() if k.upper() in allowed or k in manifest["runtime"]["settings"]}
    env.update({"PYTHONDONTWRITEBYTECODE": "1", "PIP_NO_INDEX": "1", "YOLO_AUTOINSTALL": "false"})
    record = {"schemaVersion": 1, "sourceCommit": COMMIT, "pose3dTree": TREE, "tag": TAG,
              "environmentVersion": version, "input": identity, "reused": False,
              "localEvaluationAuthorized": True, "offlineHostAttested": True, "status": "started"}
    (output / "run-record.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    try:
        # Logs remain private: the historical source prints paths and clip metadata.
        with (output / "private-runtime.log").open("xb") as log:
            result = subprocess.run([sys.executable, "-B", str(source / "scripts/pose3d/run_pipeline.py"), str(video), str(output)],
                                    cwd=source, env=env, stdout=log, stderr=log, timeout=3600)
        record["exitCode"] = result.returncode
        verify_source(source)
        verify_models(source, manifest)
        if file_identity(video) != identity:
            raise ValueError("INPUT_CHANGED")
        status = json.loads((output / "pipeline_status.json").read_text(encoding="utf-8"))
        if status.get("status") != "complete" or status.get("detail", {}).get("outcome") != "ok":
            raise ValueError("PIPELINE_FAILED")
        record["artifacts"] = {name: file_identity(output / name) for name in
                               ["pose_2d.json", "bat_path.json", "pose_3d.json", "metrics.json", "pipeline_status.json"]}
        # Preserve legacy Windows teardown-exit behavior, recording the actual exit code.
        record["status"] = "complete"
    finally:
        if record["status"] == "started":
            record["status"] = "failed"
        (output / "run-record.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--locks", type=Path, required=True)
    parser.add_argument("--local-evaluation-authorized", action="store_true")
    parser.add_argument("--offline-host-confirmed", action="store_true")
    args = parser.parse_args()
    configured = os.environ.get("HITTERLOOP_EVAL_ROOT")
    if not configured:
        raise ValueError("EVAL_ROOT_UNCONFIGURED")
    run(args.source, args.repository, Path(configured), args.video,
        (args.locks / "requirements.lock.txt").read_text(encoding="utf-8"),
        json.loads((args.locks / "models.lock.json").read_text(encoding="utf-8")),
        args.local_evaluation_authorized, args.offline_host_confirmed)
    print("Private baseline run completed; no accuracy claim.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Baseline execution blocked or failed: " + safe_error_code(error), file=sys.stderr)
        sys.exit(1)
