"""Offline detector adapter; injectable protocol keeps tests synthetic."""
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
import os
from scripts.engine_v2.identity import PROVISIONAL_THRESHOLDS, Unavailable

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / "scripts/models/yolo11m-pose.pt"
TRACKER = Path(__file__).parent / "config/botsort_reid.yaml"
BOX_CONF = PROVISIONAL_THRESHOLDS["box_conf"]
KEYPOINT_CONF = PROVISIONAL_THRESHOLDS["keypoint_conf"]


@dataclass
class PersonDetection:
    track_id: int | None
    box_xyxy: list
    box_conf: float
    keypoints17: list


class Detector(Protocol):
    def detect(self, frame_ndarray, index: int) -> list[PersonDetection]: ...


class YoloDetector:
    def __init__(self, device="cpu"):
        os.environ["YOLO_OFFLINE"] = "1"
        os.environ["YOLO_AUTOINSTALL"] = "false"
        if not MODEL.is_file():
            raise Unavailable("MODEL_MISSING")
        from ultralytics import YOLO
        from ultralytics.nn.modules.head import Detect
        self.model = YOLO(str(MODEL))
        head = self.model.model.model[-1]
        self.native_reid = isinstance(head, Detect) and not getattr(head, "end2end", False)
        if not self.native_reid:
            raise Unavailable("REID_NATIVE_FEATURES_UNAVAILABLE")
        self.device = device

    def detect(self, frame_ndarray, index):
        results = self.model.track(frame_ndarray, persist=True, tracker=str(TRACKER),
                                   verbose=False, device=self.device, conf=BOX_CONF,
                                   save=False, classes=[0])
        detections = []
        for result in results:
            if result.keypoints is None:
                continue
            ids = result.boxes.id
            for i, box in enumerate(result.boxes):
                detections.append(PersonDetection(
                    int(ids[i].item()) if ids is not None else None,
                    box.xyxy[0].cpu().tolist(), float(box.conf[0]),
                    result.keypoints.data[i].cpu().tolist()))
        return detections
