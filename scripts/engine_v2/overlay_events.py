"""Local diagnostic only: overlay_events.py <video> <engine_out_dir> <dest_mp4>.

Never called by the engine/worker. Output must resolve outside the working tree.
"""
import argparse
from fractions import Fraction
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import av
import cv2
from scripts.engine_v2.decode import decode
from scripts.engine_v2.run_engine import sha256


def destination_path(destination):
    try:
        root = Path(subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], cwd=Path(__file__).resolve().parent,
            stderr=subprocess.PIPE, text=True).strip()).resolve(strict=True)
    except (OSError, subprocess.CalledProcessError) as error:
        raise ValueError("Cannot establish git working tree; refusing overlay output") from error
    dest = Path(destination).resolve()
    if dest == root or root in dest.parents:
        raise ValueError("Overlay destination must be outside the git working tree")
    if dest.exists():
        raise ValueError("Overlay destination already exists")
    if dest.suffix.lower() != ".mp4":
        raise ValueError("Overlay destination must be an MP4")
    return dest


def overlay(video, engine_out_dir, destination):
    dest = destination_path(destination)  # Refuse before opening media/artifacts.
    out = Path(engine_out_dir)
    read = lambda name: json.loads((out / name).read_text(encoding="utf-8"))
    fmap, tracks, bats, metrics = [read(n) for n in ("frame_map.json", "tracks.json", "bat_path.json", "metrics.json")]
    if sha256(video) != fmap["input_sha256"]:
        raise ValueError("Video does not match the engine frame map")
    selected = tracks["batter"]["segment_id"]
    poses = {r["index"]: r for s in tracks["segments"] if s["id"] == selected for r in s["rows"]}
    bat_by_frame = {b["frame"]: b for b in bats["frames"]}
    markers = {}
    for event in metrics["events"]:
        if event["status"] == "available":
            markers.setdefault(event["frame"], []).append(event)
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Reserve without replacing existing output, including concurrent writers.
    with dest.open("xb") as target, av.open(target, "w", format="mp4") as container:
        stream = None
        count = 0
        for frame, raster in decode(video, {}):
            index = frame["index"]
            if index >= len(fmap["frames"]) or any(frame[k] != fmap["frames"][index][k]
                    for k in ("index", "pts", "time_base", "time_s")):
                raise ValueError("Source presentation map mismatch")
            if stream is None:
                stream = container.add_stream("libx264")
                stream.width, stream.height = raster.shape[1], raster.shape[0]
                stream.pix_fmt = "yuv420p"
                stream.time_base = stream.codec_context.time_base = Fraction(*frame["time_base"])
            if index in poses:
                x1, y1, x2, y2 = map(round, poses[index]["box_xyxy"])
                cv2.rectangle(raster, (x1, y1), (x2, y2), (80, 220, 80), 1)
            b = bat_by_frame.get(index, {})
            if b.get("status") == "detected":
                knob, tip = tuple(map(round, b["knob"])), tuple(map(round, b["tip"]))
                cv2.line(raster, knob, tip, (160, 160, 160), 1)
                cv2.circle(raster, knob, 3, (140, 140, 140), 1)
                cv2.circle(raster, tip, 4, (0, 230, 255), -1)
            labels = [f"PTS {frame['pts']}  {frame['time_s']:.6f}s"]
            labels += [f"{e['id']} PTS {e['pts']}" for e in markers.get(index, [])]
            for line, label in enumerate(labels):
                cv2.putText(raster, label, (4, 14 + line * 16), cv2.FONT_HERSHEY_SIMPLEX,
                            .35, (255, 255, 255), 1, cv2.LINE_AA)
            encoded = av.VideoFrame.from_ndarray(raster, format="bgr24")
            encoded.pts, encoded.time_base = frame["pts"], Fraction(*frame["time_base"])
            for packet in stream.encode(encoded):
                container.mux(packet)
            count += 1
        if count != len(fmap["frames"]) or stream is None:
            raise ValueError("Incomplete source presentation map")
        for packet in stream.encode():
            container.mux(packet)
    return dest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video")
    parser.add_argument("engine_out_dir")
    parser.add_argument("dest_mp4")
    args = parser.parse_args()
    overlay(args.video, args.engine_out_dir, args.dest_mp4)
