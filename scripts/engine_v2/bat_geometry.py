"""Pure mask -> oriented bat segment. Never derives endpoints from an axis-aligned box.

Coordinates are pixel-index coordinates (x = column, y = row) in the displayed raster.
"""
from math import atan2, degrees
import cv2
import numpy as np
from scripts.engine_v2.identity import PROVISIONAL_BAT_THRESHOLDS as B


def _axis(points):
    mean = points.mean(axis=0)
    values, vectors = np.linalg.eigh(np.cov((points - mean).T))
    major, minor = vectors[:, 1], vectors[:, 0]
    if major[0] < 0 or (major[0] == 0 and major[1] < 0):
        major = -major  # Deterministic sign; endpoint identity is decided later, never here.
    return mean, major, np.array([-major[1], major[0]]), values[1], values[0]


def rejected(*reasons, **extra):
    return {"ok": False, "reason_codes": list(reasons), **extra}


def mask_geometry(mask):
    mask = np.asarray(mask, dtype=bool)
    area = int(mask.sum())
    if area == 0:
        return rejected("EMPTY_MASK", area=0)
    if area < B["min_pixels"]:
        return rejected("TOO_FEW_PIXELS", area=area)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    order = sorted(range(1, count), key=lambda i: (-stats[i, cv2.CC_STAT_AREA], i))
    largest = order[0]
    ys, xs = np.nonzero(labels == largest)
    points = np.column_stack([xs, ys]).astype(float)
    if len(points) < 3:
        return rejected("TOO_FEW_PIXELS", area=area)
    mean, major, minor, l1, l2 = _axis(points)
    if l1 <= 0 or l2 / l1 > B["max_isotropy"]:
        return rejected("DEGENERATE_AXIS", area=area)
    spread = (points - mean) @ minor
    half_width = max(float(np.percentile(np.abs(spread), 100 - B["trim_percent"])), 0.5)
    along_largest = (points - mean) @ major
    low_largest, high_largest = float(along_largest.min()), float(along_largest.max())
    merged = [largest]
    for index in order[1:]:
        if stats[index, cv2.CC_STAT_AREA] < B["fragment_min_fraction"] * area:
            continue  # Specks are ignored, not merged.
        # A fragment joins only when it continues the same bat: perpendicular offset at most one mask
        # width (2 x half-width) AND an along-axis gap no longer than a short occlusion.
        offset = abs(float((centroids[index] - mean) @ minor))
        fy, fx = np.nonzero(labels == index)
        fragment_along = (np.column_stack([fx, fy]).astype(float) - mean) @ major
        gap = max(0.0, float(fragment_along.min()) - high_largest, low_largest - float(fragment_along.max()))
        if offset > 2 * half_width or gap > B["fragment_max_gap_widths"] * 2 * half_width:
            return rejected("FRAGMENTED_MASK", area=area)
        merged.append(index)
    if len(merged) > 1:
        ys, xs = np.nonzero(np.isin(labels, merged))
        points = np.column_stack([xs, ys]).astype(float)
        mean, major, minor, l1, l2 = _axis(points)
        if l1 <= 0 or l2 / l1 > B["max_isotropy"]:
            return rejected("DEGENERATE_AXIS", area=area)
    along, across = (points - mean) @ major, (points - mean) @ minor
    low, high = np.percentile(along, [B["trim_percent"], 100 - B["trim_percent"]])
    width = float(np.percentile(across, 100 - B["trim_percent"]) - np.percentile(across, B["trim_percent"])) + 1.0
    length = float(high - low)
    elongation = length / max(width, 1.0)
    shape = {"area": area, "length_px": round(length, 2), "width_px": round(width, 2),
             "elongation": round(elongation, 3), "angle_deg": round(degrees(atan2(major[1], major[0])) % 180, 2),
             "fragmented": len(merged) > 1}
    if elongation < B["min_elongation"]:
        return rejected("NOT_ELONGATED", **shape)
    ends = [mean + low * major, mean + high * major]
    return {"ok": True, "reason_codes": [], **shape,
            "endpoints": [[round(float(p[0]), 2), round(float(p[1]), 2)] for p in ends]}
