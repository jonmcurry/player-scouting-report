"""inst-1: observation only. Never returns frames or decisions to the engine.

Signatures stay in RAM; artifacts contain identities, counts and numeric scores,
never pixels, paths, exception text, or external-provider data.
"""
import hashlib
import copy
import json
import math
import os
import re
from pathlib import Path
import subprocess
import sys
import threading
import uuid
from fractions import Fraction

VERSION = "inst-1"
ENGINE = "engine-baseline-1.0.0"
EXPECTED_ENVIRONMENT = "env-f4ad5b330d0c"
BASELINE_COMMIT = "f79b09e63092e87efd1250c3b263d29086d81a79"
BASELINE_TREE = "766f4fbc64620d428da428e59b144554ca2f2a7b"
ROOT = Path(__file__).resolve().parents[3]
MAX_FRAMES = 20000
MAX_PAIRS = 5000000
MAX_MSE = 16.0  # provisional 8-bit thumbnail MSE; unique candidate required
SAFE_FAILURES = {"INVALID_TIME_BASE", "INVENTORY_LIMIT_OR_EMPTY", "UNSUPPORTED_ROTATION",
                 "DIMENSION_LIMIT", "DECODE_SIZE_OR_LIMIT", "DECODER_COUNT_DISAGREEMENT",
                 "COMMAND_FAILED", "INVALID_TRANSFORM_METADATA", "INPUT_CHANGED",
                 "INVALID_PTS", "LEGACY_ROTATION_TAG_UNVERIFIED"}
_session = None


def command(args, cwd=None):
    p = subprocess.run(args, cwd=cwd, capture_output=True, timeout=120,
                       env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"})
    if p.returncode:
        raise RuntimeError("COMMAND_FAILED")
    return p.stdout


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1048576), b""):
            h.update(block)
    return h.hexdigest()


def signature(frame):
    import cv2
    # Both functions allocate a new array; the model's orig_img is never mutated.
    return cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (32, 32),
                      interpolation=cv2.INTER_AREA).reshape(-1)


def presentation_timestamp(value):
    if value is None or value == "N/A":
        return None
    if type(value) is int:
        return value
    if isinstance(value, str) and re.fullmatch(r"-?\d+", value):
        return int(value)
    # Never truncate a float or coerce a Boolean into a PTS.
    raise ValueError("INVALID_PTS")


def display_rotation(stream):
    rotation = next((s["rotation"] for s in stream.get("side_data_list", []) if "rotation" in s), None)
    if rotation is None:
        if str(stream.get("tags", {}).get("rotate", "0")) not in ("0", "0.0"):
            # No independently tested decoder agreement for legacy tag-only
            # orientation. Do not reshape pixels using an assumed tag meaning.
            raise ValueError("LEGACY_ROTATION_TAG_UNVERIFIED")
        rotation = 0
    if type(rotation) not in (int, float) or not math.isfinite(rotation) or rotation % 90:
        raise ValueError("UNSUPPORTED_ROTATION")
    return rotation


def inventory(path):
    """FFprobe decoded PTS + FFmpeg presentation-order content, no guessed PTS.

    FFmpeg's autorotation is retained, matching the ordinary model decoder.
    Count disagreement invalidates the inventory; best_effort timestamps are
    deliberately not used as substitutes for absent presentation timestamps.
    """
    import numpy as np
    data = json.loads(command(["ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_frames", "-show_streams", "-show_entries",
        "frame=pts:stream=width,height,time_base,r_frame_rate,avg_frame_rate:stream_side_data=rotation:stream_tags=rotate",
        "-of", "json", str(path)]))
    stream = data["streams"][0]
    time_base = Fraction(stream["time_base"])
    if time_base <= 0:
        raise ValueError("INVALID_TIME_BASE")
    pts = [presentation_timestamp(f.get("pts")) for f in data["frames"]]
    if not pts or len(pts) > MAX_FRAMES:
        raise ValueError("INVENTORY_LIMIT_OR_EMPTY")
    width, height = int(stream["width"]), int(stream["height"])
    rotation = display_rotation(stream)
    if abs(rotation) % 180 == 90:
        width, height = height, width
    if width <= 0 or height <= 0 or width * height > 16777216:
        raise ValueError("DIMENSION_LIMIT")
    process = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:v:0",
        "-an", "-sn", "-dn", "-fps_mode", "passthrough", "-pix_fmt", "bgr24",
        "-f", "rawvideo", "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    timer = threading.Timer(120, process.kill)
    timer.start()
    images = []
    try:
        frame_bytes = width * height * 3
        while True:
            block = process.stdout.read(frame_bytes)
            if not block:
                break
            if len(block) != frame_bytes or len(images) >= MAX_FRAMES:
                raise ValueError("DECODE_SIZE_OR_LIMIT")
            images.append(signature(np.frombuffer(block, np.uint8).reshape(height, width, 3)))
        if process.wait() != 0 or len(images) != len(pts):
            raise ValueError("DECODER_COUNT_DISAGREEMENT")
    finally:
        timer.cancel()
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()
    try:
        fps = float(Fraction(stream["r_frame_rate"]))
        if not math.isfinite(fps) or fps <= 0:
            fps = None
    except (ValueError, ZeroDivisionError):
        fps = None
    return {"pts": pts, "time_base": str(time_base), "nominal_fps": fps,
            "rotation_degrees": rotation, "signatures": images}


def timing(inv, algorithm_fps=None):
    base = Fraction(inv["time_base"])
    times = [float(p * base) if p is not None else None for p in inv["pts"]]
    complete = bool(times) and all(t is not None for t in times)
    deltas = [b-a for a,b in zip(times,times[1:]) if a is not None and b is not None]
    fps = algorithm_fps if algorithm_fps is not None else inv["nominal_fps"]
    return {"decoded_frames": len(times), "nominal_fps": inv["nominal_fps"],
            "algorithm_fps": algorithm_fps, "time_base": inv["time_base"],
            "rotation_degrees": inv["rotation_degrees"],
            "pts_complete": complete, "missing_pts": times.count(None),
            "nonincreasing_pts": sum(d <= 0 for d in deltas),
            "first_pts_s": times[0] if times else None,
            "last_pts_s": times[-1] if times else None,
            "min_delta_s": min(deltas) if deltas else None,
            "max_delta_s": max(deltas) if deltas else None,
            "observed_fps": (len(times)-1)/(times[-1]-times[0])
                if complete and len(times)>1 and all(d>0 for d in deltas) else None,
            "max_pts_index_deviation_s": max(abs(t-i/fps) for i,t in enumerate(times))
                if complete and fps and math.isfinite(fps) and fps > 0 else None}


def matches(observed, reference):
    """Search the entire reference, not an offset-derived window.

    Exactly one candidate must meet the recorded tolerance. Identical/repeated
    content is ambiguous even if an index formula could choose one candidate.
    """
    import numpy as np
    if len(observed) * len(reference) > MAX_PAIRS:
        return [(None, None, "MATCH_BUDGET_EXCEEDED")] * len(observed)
    if not reference:
        return [(None, None, "REFERENCE_EMPTY")] * len(observed)
    matrix = np.asarray(reference, dtype=np.float32)
    result = []
    for frame in observed:
        errors = np.mean((matrix - frame.astype(np.float32)) ** 2, axis=1)
        candidates = np.flatnonzero(errors <= MAX_MSE)
        if len(candidates) != 1:
            result.append((None, float(errors.min()),
                           "CONTENT_AMBIGUOUS" if len(candidates) else "CONTENT_NO_MATCH"))
        else:
            index = int(candidates[0])
            result.append((index, float(errors[index]), None))
    return result


def build_map(raw, intermediate, analysis, pose, bat, transformation):
    rows = []
    failures = []
    if not pose:
        failures.append("NO_ANALYZED_FRAMES")
    if len(pose) != len(bat) or len(pose) != len(analysis["pts"]):
        failures.append("DECODER_COUNT_DISAGREEMENT")
    for inv in (raw, intermediate, analysis):
        ts = timing(inv)
        if not ts["pts_complete"]:
            failures.append("MISSING_PTS")
        if ts["nonincreasing_pts"]:
            failures.append("NONINCREASING_PTS")
    raw_matches = matches(pose, raw["signatures"])
    mid_matches = matches(pose, intermediate["signatures"])
    mid_to_raw = matches(intermediate["signatures"], raw["signatures"])
    pose_to_analysis = matches(pose, analysis["signatures"])
    bat_to_analysis = matches(bat, analysis["signatures"])
    previous = -1
    for i, (raw_i, score, reason) in enumerate(raw_matches):
        mid_i, mid_score, mid_reason = mid_matches[i]
        row_reasons = list(failures)
        row_reasons.extend(x for x in (reason, mid_reason, pose_to_analysis[i][2]) if x)
        if pose_to_analysis[i][0] != i or i >= len(bat_to_analysis) or bat_to_analysis[i][0] != i:
            row_reasons.append("MODEL_DECODER_CONTENT_DISAGREEMENT")
        if mid_i is not None and (mid_to_raw[mid_i][2] or mid_to_raw[mid_i][0] != raw_i):
            row_reasons.append("TRANSFORM_COMPOSITION_UNVERIFIED")
        if raw_i is not None:
            if raw_i <= previous:
                row_reasons.append("NONUNIQUE_OR_REORDERED_CORRESPONDENCE")
            previous = raw_i
        ok = not row_reasons and raw_i is not None and mid_i is not None
        rows.append({"analysis_index": i, "raw_frame": raw_i if ok else None,
                     "raw_pts": raw["pts"][raw_i] if ok else None,
                     "raw_time_base": raw["time_base"] if ok else None,
                     "raw_pts_s": float(raw["pts"][raw_i]*Fraction(raw["time_base"])) if ok else None,
                     "intermediate_frame": mid_i if ok else None,
                     "intermediate_pts": intermediate["pts"][mid_i] if ok else None,
                     "intermediate_time_base": intermediate["time_base"] if ok else None,
                     "analysis_pts": analysis["pts"][i] if i < len(analysis["pts"]) else None,
                     "analysis_time_base": analysis["time_base"],
                     "status": "verified" if ok else "unmappable",
                     "reasons": sorted(set(row_reasons)),
                     "raw_content_mse": score, "intermediate_content_mse": mid_score})
    reasons = sorted(set(failures + [r for row in rows for r in row["reasons"]]))
    return {"schema_version": 1, "instrumentation_version": VERSION,
            "verified": bool(rows) and not reasons, "status": "unmappable" if reasons else "verified",
            "reasons": reasons, "verification": {"method": "unique_global_content_match",
                "thumbnail": "32x32_grayscale_area", "max_mse": MAX_MSE,
                "max_frames": MAX_FRAMES, "max_pairs": MAX_PAIRS, "scope": "every_pose_and_bat_frame"},
            "transformation": transformation, "frames": rows}


def atomic_json(directory, name, data):
    # Existing artifact symlinks must not redirect private results elsewhere.
    path = directory / name
    temp = directory / (name + ".inst1-tmp")
    if path.is_symlink() or temp.exists() or temp.is_symlink():
        raise OSError("UNSAFE_ARTIFACT_TARGET")
    try:
        with temp.open("x", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, sort_keys=True, indent=2, allow_nan=False)
            f.write("\n")
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def unavailable_rows(count, reasons):
    return [{"analysis_index": i, "raw_frame": None, "raw_pts": None,
             "raw_time_base": None, "raw_pts_s": None, "intermediate_frame": None,
             "intermediate_pts": None, "intermediate_time_base": None,
             "analysis_pts": None, "analysis_time_base": None,
             "status": "unmappable", "reasons": reasons,
             "raw_content_mse": None, "intermediate_content_mse": None} for i in range(count)]


def pipeline_runtime_settings():
    # Read only already imported torch state; never initialize a runtime here.
    torch = sys.modules.get("torch")
    result = {"scope": "pipeline_process_at_finish", "torch_loaded": torch is not None}
    if torch is not None:
        result.update(cudnn_benchmark=torch.backends.cudnn.benchmark,
                      cudnn_deterministic=torch.backends.cudnn.deterministic,
                      deterministic_algorithms=torch.are_deterministic_algorithms_enabled(),
                      tf32_matmul=torch.backends.cuda.matmul.allow_tf32,
                      tf32_cudnn=torch.backends.cudnn.allow_tf32,
                      torch_threads=torch.get_num_threads(),
                      torch_interop_threads=torch.get_num_interop_threads())
    return result


class Session:
    def __init__(self, video, out):
        self.video, self.out = Path(video), Path(out)
        self.raw = None
        self.attempt = None
        self.attempt_number = 0
        self.attempt_history = []
        self.run_id = uuid.uuid4().hex
        self.manifest = {"schema_version": 1, "engine_code_version": ENGINE,
                         "original_source_commit": BASELINE_COMMIT, "original_source_tree": BASELINE_TREE,
                         "instrumentation_version": VERSION,
                         "expected_environment_version": EXPECTED_ENVIRONMENT,
                         "environment_version": None, "source_commit": None, "source_dirty": None,
                         "input_sha256": None, "model_integrity": None,
                         "status": "unverified", "reasons": ["RUN_INCOMPLETE"]}
        self.frame_map = {"schema_version": 1, "instrumentation_version": VERSION,
                          "verified": False, "status": "unmappable",
                          "reasons": ["RUN_INCOMPLETE"], "frames": []}
        self.errors = []

    def write(self):
        self.frame_map.update(run_id=self.run_id, input_sha256=self.manifest["input_sha256"],
                              attempt_number=self.attempt_number)
        self.manifest["run_id"] = self.run_id
        self.frame_map["attempt_history"] = self.attempt_history
        self.manifest["frame_map_sha256"] = hashlib.sha256(
            (json.dumps(self.frame_map, sort_keys=True, indent=2, allow_nan=False)+"\n").encode()).hexdigest()
        atomic_json(self.out, "frame_map.json", self.frame_map)
        atomic_json(self.out, "engine_manifest.json", self.manifest)

    def begin(self):
        self.write()  # replaces previous-run results with explicit incomplete state
        self.manifest["input_sha256"] = digest(self.video)
        self.manifest["source_commit"] = command(["git", "rev-parse", "HEAD"], ROOT).decode().strip()
        self.manifest["source_dirty"] = bool(command(["git", "status", "--porcelain", "--untracked-files=normal"], ROOT).strip())
        try:
            command(["node", "scripts/check-baseline-tree.mjs"], ROOT)
            self.manifest["source_verification"] = "registered"
        except Exception:
            self.errors.append("SOURCE_NOT_REGISTERED")
            self.manifest["source_verification"] = "unverified"
        try:
            provenance = json.loads(command([sys.executable, str(Path(__file__).with_name("provenance_v1.py"))]))
            self.errors.extend(provenance.pop("provenance_reasons"))
            self.manifest.update(provenance)
        except Exception:
            self.errors.append("ENVIRONMENT_CAPTURE_FAILED")
        self.raw = inventory(self.video)
        self.manifest["original_timing"] = timing(self.raw)
        self.write()

    def start_attempt(self, intermediate, analysis, candidate, decimation, number):
        self.attempt_number = number
        for key in ("analysis_timing", "intermediate_timing"):
            self.manifest.pop(key, None)
        self.attempt = {"pose": [], "bat": [], "counts": {"pose": 0, "bat": 0}, "fps": None,
                        "finalized": False,
                        "errors": [], "intermediate_path": Path(intermediate),
                        "analysis_path": Path(analysis), "transformation": {
                            "trim_start_s": candidate.get("trim_start_s"),
                            "trim_end_s": candidate.get("trim_end_s"),
                            "decimation_factor": decimation.get("decimation_factor"),
                            "decimated": decimation.get("decimated") is True,
                            "declared_only": True}}
        for key in ("trim_start_s", "trim_end_s", "decimation_factor"):
            value = self.attempt["transformation"][key]
            if value is not None and (type(value) not in (int, float) or not math.isfinite(value)):
                self.attempt["transformation"][key] = None
                raise ValueError("INVALID_TRANSFORM_METADATA")
        # No probe/decode until after CV completes; never touch the model iterator.

    def observe(self, kind, frame):
        if self.attempt is None:
            return
        a = self.attempt
        a["counts"][kind] += 1
        if len(a[kind]) >= MAX_FRAMES:
            a["errors"].append("OBSERVATION_LIMIT")
            return
        try:
            a[kind].append(signature(frame))
        except Exception:
            a["errors"].append("FRAME_OBSERVATION_FAILED")

    def end_attempt(self):
        if self.attempt is not None and self.attempt["finalized"]:
            return
        mapping_errors = []
        if self.attempt is not None:
            self.manifest.update(attempt_number=self.attempt_number,
                pose_decoded_frames=self.attempt["counts"]["pose"],
                bat_decoded_frames=self.attempt["counts"]["bat"])
        if self.attempt is None or self.raw is None:
            self.errors.append("NO_COMPLETED_DECODE_INVENTORY")
            self.frame_map.update(verified=False, status="unmappable", reasons=["NO_COMPLETED_DECODE_INVENTORY"],
                frames=unavailable_rows(self.attempt["counts"]["pose"] if self.attempt else 0,
                                        ["NO_COMPLETED_DECODE_INVENTORY"]))
        else:
            a = self.attempt
            intermediate = inventory(a["intermediate_path"])
            analysis = inventory(a["analysis_path"])
            self.frame_map = build_map(self.raw, intermediate, analysis, a["pose"], a["bat"], a["transformation"])
            self.errors.extend(a["errors"])
            mapping_errors.extend(a["errors"])
            self.manifest.update({"attempt_number": self.attempt_number,
                "pose_decoded_frames": a["counts"]["pose"], "bat_decoded_frames": a["counts"]["bat"],
                "intermediate_timing": timing(intermediate), "analysis_timing": timing(analysis, a["fps"])})
        if mapping_errors:
            self.frame_map.update(verified=False, status="unmappable")
            self.frame_map["reasons"] = sorted(set(self.frame_map["reasons"] + mapping_errors))
            self.frame_map["frames"] = unavailable_rows(self.attempt["counts"]["pose"] if self.attempt else 0,
                                                       self.frame_map["reasons"])
        self.record_attempt()

    def record_attempt(self):
        if self.attempt is not None and not self.attempt["finalized"]:
            self.attempt["finalized"] = True
            mapping = copy.deepcopy({k: v for k, v in self.frame_map.items() if k != "attempt_history"})
            self.attempt_history.append({"attempt_number": self.attempt_number,
                "pose_decoded_frames": self.attempt["counts"]["pose"],
                "bat_decoded_frames": self.attempt["counts"]["bat"],
                "analysis_timing": self.manifest.get("analysis_timing"), "frame_map": mapping})
            self.errors.extend(self.frame_map["reasons"])

    def finish(self):
        self.end_attempt()
        if digest(self.video) != self.manifest["input_sha256"]:
            raise ValueError("INPUT_CHANGED")
        self.manifest["pipeline_runtime_settings"] = pipeline_runtime_settings()
        reasons = sorted(set(self.errors))
        self.manifest.update(status="verified" if not reasons else "unverified", reasons=reasons,
                             verification_scope="instrumentation_only_not_analysis_success")
        self.write()


def call(action, *args):
    """Failure isolation: a diagnostic error cannot alter the engine's outcome."""
    global _session
    try:
        if action == "begin":
            _session = Session(*args)
        if _session is None:
            return
        if action == "fps":
            if _session.attempt is not None:
                _session.attempt["fps"] = float(args[0])
        else:
            getattr(_session, action)(*(() if action == "begin" else args))
    except Exception as error:
        if _session is not None:
            _session.errors.append("INSTRUMENTATION_" + action.upper() + "_FAILED")
            if type(error) in (ValueError, RuntimeError) and str(error) in SAFE_FAILURES:
                _session.errors.append(str(error))
            _session.manifest.update(status="unverified", reasons=sorted(set(_session.errors)))
            count = _session.attempt["counts"]["pose"] if _session.attempt else 0
            _session.manifest.update(pose_decoded_frames=count,
                bat_decoded_frames=_session.attempt["counts"]["bat"] if _session.attempt else 0)
            _session.frame_map.update(verified=False, status="unmappable", reasons=sorted(set(_session.errors)),
                frames=unavailable_rows(count, sorted(set(_session.errors))))
            if action == "end_attempt":
                _session.record_attempt()
            if action == "finish":
                for record in _session.attempt_history:
                    record["frame_map"].update(verified=False, status="unmappable", reasons=sorted(set(_session.errors)),
                        frames=unavailable_rows(record["pose_decoded_frames"], sorted(set(_session.errors))))
            try:
                _session.write()
            except Exception:
                print("[inst-1] ARTIFACT_WRITE_FAILED", file=sys.stderr)
