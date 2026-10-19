"""Offline COCO segmentation adapter for the bat stage; injectable protocol keeps tests synthetic."""
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
from typing import Protocol
import numpy as np
from scripts.engine_v2.identity import PROVISIONAL_BAT_THRESHOLDS as B, Unavailable

ROOT = Path(__file__).resolve().parents[2]
# Read in place (shared with the offline privacy tool); never moved, copied or downloaded.
SEG_MODEL = ROOT / "scripts/models/pr5-baseline-recovery/yolo11m-seg.pt"
SEG_MODEL_RELATIVE = "scripts/models/pr5-baseline-recovery/yolo11m-seg.pt"
SEG_SHA256 = "eb9a06f63e2206c35d68d839b08c362429ebecf933ad54c1ad68b2fd001c17cf"
SEG_BYTES = 45400152
BAT_CLASS_ID, BAT_CLASS_NAME = 34, "baseball bat"


@dataclass
class BatMask:
    mask: np.ndarray  # bool, displayed-raster height x width
    score: float  # uncalibrated model score


class BatSegmenter(Protocol):
    def segment(self, frame_ndarray, index: int) -> list[BatMask]: ...


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class YoloBatSegmenter:
    def __init__(self, device="cpu", model_path=SEG_MODEL):
        os.environ["YOLO_OFFLINE"] = "1"
        os.environ["YOLO_AUTOINSTALL"] = "false"
        path = Path(model_path)
        if not path.is_file():
            raise Unavailable("BAT_MODEL_MISSING")
        if path.stat().st_size != SEG_BYTES or _sha256(path) != SEG_SHA256:
            raise Unavailable("BAT_MODEL_HASH_MISMATCH")
        from ultralytics import YOLO
        self.model = YOLO(str(path))
        if self.model.task != "segment" or self.model.names.get(BAT_CLASS_ID) != BAT_CLASS_NAME:
            raise Unavailable("BAT_CLASS_MAP_MISMATCH")
        self.device, self.sha256, self.bytes = device, SEG_SHA256, SEG_BYTES

    def segment(self, frame_ndarray, index):
        height, width = frame_ndarray.shape[:2]
        masks = []
        for result in self.model.predict(frame_ndarray, classes=[BAT_CLASS_ID], conf=B["model_conf"],
                                         retina_masks=True, verbose=False, device=self.device, save=False):
            if result.masks is None:
                continue
            data = result.masks.data.cpu().numpy() > 0.5
            for i, score in enumerate(result.boxes.conf.cpu().tolist()):
                if data[i].shape != (height, width):
                    raise RuntimeError(f"segmentation mask {data[i].shape} does not match raster {(height, width)}")
                masks.append(BatMask(data[i], float(score)))
        return masks
