"""HitterLoop experimental v2 engine: person/batter, bat geometry and provisional events."""
import argparse
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import platform
import sys
import time
import traceback

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.engine_v2.identity import (IDENTITY, DETECTOR_VERSION, KEYPOINT_NAMES, THRESHOLDS_SHA256,
                                       BAT_THRESHOLDS_SHA256, SELECTION_THRESHOLDS_SHA256, EVENT_THRESHOLDS_SHA256, Unavailable)
from scripts.engine_v2.events import detect_events
from scripts.engine_v2.decode import decode, aggregates
from scripts.engine_v2.tracking import MODEL, TRACKER, YoloDetector
from scripts.engine_v2.continuity import split_tracks
from scripts.engine_v2.batter import select_batter
from scripts.engine_v2.grounded import ground_batter
from scripts.engine_v2.bat_model import (YoloBatSegmenter, SEG_MODEL_RELATIVE, SEG_SHA256, SEG_BYTES,
                                        BAT_CLASS_ID, BAT_CLASS_NAME)
from scripts.engine_v2.bat_geometry import mask_geometry
from scripts.engine_v2.bat_track import summarize

ARTIFACTS = ("frame_map.json", "pose_2d.json", "tracks.json", "metrics.json",
             "engine_manifest.json", "pipeline_status.json", "pose_3d.json", "bat_path.json", "events_timeline.json")
PHASES = ("stance", "load", "stride", "contact", "extension", "follow_through")


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def run(video, out_dir, detector=None, max_frames=12000, device="auto", bat_model=None,
        clock=time.perf_counter, now=lambda: datetime.now(timezone.utc).isoformat()):
    video, out_dir = Path(video), Path(out_dir)
    status, detail = "crashed", {"reason_codes": ["UNEXPECTED_EXCEPTION"]}
    os.environ["YOLO_OFFLINE"] = "1"
    os.environ["YOLO_AUTOINSTALL"] = "false"
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        for name in (*ARTIFACTS, "pipeline_status.json.tmp"):
            artifact = out_dir / name
            if artifact.exists() or artifact.is_symlink():
                artifact.unlink()
        started = clock()
        if device == "auto":
            import torch
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
        input_hash = sha256(video)
        input_bytes = video.stat().st_size
        print("[engine_v2] Stage 1/3 decode+track", flush=True)
        frames, observations = [], []
        metadata = {"width": None, "height": None, "raw_width": None, "raw_height": None,
                    "rotation": None, "time_base": None, "nominal_rate": None}
        decode_reason = None
        bat_candidates, bat_failure, bat_seconds, segmenter = {}, None, 0.0, None
        try:
            detector = detector if detector is not None else YoloDetector(device)
            # Bat failures stay local; usable evidence can ground the final pose-eligible choice.
            try:
                segmenter = bat_model if bat_model is not None else YoloBatSegmenter(device)
            except Unavailable as error:
                segmenter, bat_failure = None, error.reason
            for record, raster in decode(video, metadata, max_frames):
                frames.append(record)
                for person in detector.detect(raster, record["index"]):
                    observations.append({**record, **vars(person), "display_height": raster.shape[0]})
                if segmenter is not None and bat_failure is None:
                    bat_started = clock()
                    try:
                        bat_candidates[record["index"]] = [{**mask_geometry(m.mask), "score": float(m.score)}
                                                           for m in segmenter.segment(raster, record["index"])]
                    except Exception:
                        traceback.print_exc()
                        bat_failure = "BAT_MODEL_ERROR"
                    bat_seconds += clock() - bat_started
        except Unavailable as error:
            decode_reason = error.reason
        tracked_at = clock()
        print("[engine_v2] Stage 2/3 batter", flush=True)
        tracks, segments, events = split_tracks(observations)
        decision, candidates = select_batter(segments)
        if decode_reason or not frames:
            decision = {"status": "unavailable", "segment_id": None,
                        "reason_codes": [decode_reason or "DECODE_ERROR"]}
        pose_decision = decision
        decision, evidence, bat_result = ground_batter(
            pose_decision, candidates, segments, frames, bat_candidates,
            "DECODE_UNAVAILABLE" if decode_reason or not frames else bat_failure)
        selected = next((s for s in segments if s["id"] == decision["segment_id"]), None)
        poses = {r["index"]: r["keypoints17"] for r in selected["rows"]} if selected else {}
        stats = aggregates(frames)
        batter_rows = {r["index"]: r for r in selected["rows"]} if selected else {}
        bat_rows, bat_status, bat_reasons = bat_result
        event_metrics, timeline = detect_events(frames, batter_rows, bat_rows, decision,
                                                (metadata["width"], metadata["height"]))
        selected_at = clock()
        print("[engine_v2] Stage 3/3 write", flush=True)
        write_json(out_dir / "frame_map.json", {**IDENTITY, "schema": "hitterloop.engine-v2.frame-map",
                   "schema_version": "1.0.0", "input_sha256": input_hash, "frames": frames,
                   **metadata, **stats})
        write_json(out_dir / "pose_2d.json", {"meta": {**IDENTITY, **metadata,
                   "video": str(video), "fps": metadata.get("nominal_rate"), "fps_semantics": "nominal_only",
                   "n_frames": len(frames), "vfr": stats["vfr"], "keypoint_order": "coco17",
                   "keypoint_names": KEYPOINT_NAMES, "batter_selection": decision, "smoothing": "none"},
                   "frames": [{"frame": f["index"], "pts": f["pts"], "time_s": f["time_s"],
                               "keypoints": [[round(x, 2), round(y, 2), round(c, 3)] for x, y, c in poses[f["index"]]]
                               if f["index"] in poses else None} for f in frames]})
        raster_meta = {k: metadata.get(k) for k in ("width", "height", "raw_width", "raw_height", "rotation", "time_base")}
        write_json(out_dir / "bat_path.json", {"meta": {**IDENTITY, **raster_meta, "video": str(video),
                   "fps": metadata.get("nominal_rate"), "fps_semantics": "nominal_only", "n_frames": len(frames),
                   "vfr": stats["vfr"], "bat_status": bat_status, "bat_reason_codes": bat_reasons,
                   "endpoint_names": {"knob": "knob", "tip": "barrel_end"},
                   "model": {"path": SEG_MODEL_RELATIVE, "pinned_sha256": SEG_SHA256, "bytes": SEG_BYTES,
                             "class_id": BAT_CLASS_ID, "class_name": BAT_CLASS_NAME,
                             "loaded_sha256": "test_double" if bat_model is not None
                             else getattr(segmenter, "sha256", None)},
                   "score_semantics": "uncalibrated_model_score", "thresholds_sha256": BAT_THRESHOLDS_SHA256,
                   "summary": summarize(bat_rows, len(batter_rows))}, "frames": bat_rows})
        write_json(out_dir / "tracks.json", {**IDENTITY, "tracks": tracks, "segments": segments,
                   "continuity_events": events, "candidates": candidates, "batter": decision,
                   "grounding": {"thresholds_sha256": SELECTION_THRESHOLDS_SHA256,
                                 "evidence": evidence, "pose_decision": pose_decision, "final_decision": decision},
                   "thresholds_sha256": THRESHOLDS_SHA256})
        write_json(out_dir / "metrics.json", {**IDENTITY, "detector_version": DETECTOR_VERSION,
                   **event_metrics, "event_thresholds_sha256": EVENT_THRESHOLDS_SHA256, "batter": decision})
        write_json(out_dir / "events_timeline.json", {**IDENTITY, "frames": timeline})
        import av
        write_json(out_dir / "engine_manifest.json", {**IDENTITY, "detector_version": DETECTOR_VERSION,
                   "versions": {"python": platform.python_version(), **{p: version(p) for p in ("torch", "ultralytics", "av")},
                                "ffmpeg": {k: list(v) for k, v in av.library_versions.items()}},
                   "device": device,
                   "native_reid": getattr(detector, "native_reid", None),
                   "model": {"path": "scripts/models/yolo11m-pose.pt", "sha256": sha256(MODEL) if MODEL.exists() else None},
                   "tracker_sha256": sha256(TRACKER), "thresholds_sha256": THRESHOLDS_SHA256,
                   "bat_model": {"path": SEG_MODEL_RELATIVE, "sha256": getattr(segmenter, "sha256", None)
                                 if bat_model is None else "test_double", "bytes": SEG_BYTES, "class_id": BAT_CLASS_ID},
                   "bat_thresholds_sha256": BAT_THRESHOLDS_SHA256,
                   "selection_thresholds_sha256": SELECTION_THRESHOLDS_SHA256,
                   "event_thresholds_sha256": EVENT_THRESHOLDS_SHA256,
                   "input_sha256": input_hash, "input_bytes": input_bytes, "frame_counts": stats,
                   "wall_times_s": {"decode_track": tracked_at-started, "bat_segment": bat_seconds,
                                    "batter_and_bat": selected_at-tracked_at,
                                    "write": clock()-selected_at}})
        status = "complete" if selected else "analysis_unavailable"
        detail = {"reason_codes": decision["reason_codes"], "bat_status": bat_status, "bat_reason_codes": bat_reasons}
    except Unavailable as error:
        status, detail = "analysis_unavailable", {"reason_codes": [error.reason]}
    except Exception as error:
        traceback.print_exc()
        detail = {"reason_codes": ["UNEXPECTED_EXCEPTION"], "exception_type": type(error).__name__}
    finally:
        temporary = out_dir / "pipeline_status.json.tmp"
        write_json(temporary, {**IDENTITY, "status": status, "detail": detail, "written_at": now()})
        os.replace(temporary, out_dir / "pipeline_status.json")
    return status


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video")
    parser.add_argument("out_dir")
    parser.add_argument("--max-frames", type=int, default=12000)
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()
    sys.exit(1 if run(args.video, args.out_dir, max_frames=args.max_frames, device=args.device) == "crashed" else 0)
