"""Stream original presentation frames; never repair or infer timestamps."""
from fractions import Fraction
from statistics import median
import av
import numpy as np
from scripts.engine_v2.identity import Unavailable


def validate_pts(pts, previous):
    if pts is None:
        raise Unavailable("MISSING_PTS")
    if previous is not None and pts <= previous:
        raise Unavailable("NONINCREASING_PTS")


def displayed_raster(frame, rotation):
    if not np.isfinite(rotation) or rotation % 90 != 0:
        raise Unavailable("UNSUPPORTED_ROTATION")
    return np.ascontiguousarray(np.rot90(frame, int(rotation / 90) % 4))


def display_rotation(frame, metadata):
    for side in frame.side_data:
        if side.type.name == "DISPLAYMATRIX":
            matrix = np.frombuffer(side, dtype=np.int32)
            # Check exact quadrant matrices: frame.rotation truncates fractional angles.
            quadrants = {(65536, 0, 0, 65536): 0, (0, -65536, 65536, 0): 90,
                         (-65536, 0, 0, -65536): 180, (0, 65536, -65536, 0): 270}
            rotation = quadrants.get(tuple(int(matrix[i]) for i in (0, 1, 3, 4)))
            if rotation is None or any(matrix[i] != 0 for i in (2, 5, 6, 7)) or matrix[8] != 1073741824:
                raise Unavailable("UNSUPPORTED_ROTATION")
            return rotation
    return float(metadata.get("rotate", 0))


def decode(video, metadata, max_frames=12000):
    previous = None
    try:
        with av.open(str(video)) as container:
            if not container.streams.video:
                raise Unavailable("NO_VIDEO_STREAM")
            stream = container.streams.video[0]
            tb = Fraction(stream.time_base)
            rate = stream.average_rate
            metadata.update(time_base=[tb.numerator, tb.denominator],
                            nominal_rate=float(rate) if rate else None)
            for index, frame in enumerate(container.decode(stream)):
                if index >= max_frames:
                    raise Unavailable("CLIP_TOO_LONG")
                validate_pts(frame.pts, previous)
                previous = frame.pts
                rotation = display_rotation(frame, stream.metadata)
                raster = displayed_raster(frame.to_ndarray(format="bgr24"), rotation)
                dimensions = {"raw_width": frame.width, "raw_height": frame.height,
                              "width": raster.shape[1], "height": raster.shape[0],
                              "rotation": rotation}
                if metadata.get("width") is not None and any(metadata[k] != v for k, v in dimensions.items()):
                    raise Unavailable("DECODE_ERROR")
                metadata.update(dimensions)
                yield {"index": index, "pts": frame.pts,
                       "time_base": metadata["time_base"],
                       "time_s": round(float(frame.pts * tb), 6),
                       "key_frame": bool(frame.key_frame), "mapping": "direct_decode"}, raster
    except Unavailable:
        raise
    except (av.FFmpegError, ValueError, OSError) as error:
        raise Unavailable("DECODE_ERROR") from error


def aggregates(frames):
    pts = [f["pts"] for f in frames]
    deltas = [b - a for a, b in zip(pts, pts[1:])]
    median_delta = median(deltas) if deltas else None
    return {"count": len(pts), "first_pts": pts[0] if pts else None,
            "last_pts": pts[-1] if pts else None,
            "vfr": bool(deltas and any(abs(d - median_delta) > 1 for d in deltas)),
            "delta_range": [min(deltas), max(deltas)] if deltas else None}
