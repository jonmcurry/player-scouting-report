"""Conservative pose-only selection. No longest-track fallback."""
from fractions import Fraction
from math import dist
from statistics import median
from scripts.engine_v2.identity import PROVISIONAL_THRESHOLDS as T


def select_batter(segments):
    candidates = []
    for segment in segments:
        rows = segment["rows"]
        grip, above = 0, 0
        for row in rows:
            p = row["keypoints17"]
            confident = lambda ids: all(p[i][2] >= T["keypoint_conf"] for i in ids)
            shoulder = dist(p[5][:2], p[6][:2])
            grip += bool(confident((5, 6, 9, 10)) and shoulder > 0 and
                         dist(p[9][:2], p[10][:2]) <= T["grip_shoulder_widths"] * shoulder)
            above += bool(confident((9, 10, 11, 12)) and
                          max(p[9][1], p[10][1]) < min(p[11][1], p[12][1]))
        duration = float((rows[-1]["pts"] - rows[0]["pts"]) * Fraction(*rows[0]["time_base"]))
        g, a = grip / len(rows), above / len(rows)
        size = median((r["box_xyxy"][3] - r["box_xyxy"][1]) / r["display_height"] for r in rows)
        reasons = []
        if duration < T["min_duration_s"]: reasons.append("SEGMENT_TOO_SHORT")
        if g < T["min_grip_fraction"] or a < T["min_hands_above_hips_fraction"]:
            reasons.append("INSUFFICIENT_GRIP_EVIDENCE")
        candidates.append({"segment_id": segment["id"], "duration_s": duration,
                           "grip_fraction": g, "hands_above_hips_fraction": a,
                           "size": size, "score": (g + a + min(size, 1)) / 3,
                           "eligible": not reasons, "reason_codes": reasons})
    eligible = sorted((c for c in candidates if c["eligible"]), key=lambda c: (-c["score"], c["segment_id"]))
    if not eligible:
        reasons = sorted({r for c in candidates for r in c["reason_codes"]})
        return {"status": "unavailable", "segment_id": None,
                "reason_codes": ["BATTER_UNAVAILABLE"] + (reasons or ["NO_PERSON_DETECTED"])}, candidates
    if len(eligible) > 1 and eligible[0]["score"] - eligible[1]["score"] <= T["score_margin"]:
        return {"status": "ambiguous", "segment_id": None, "reason_codes": ["BATTER_AMBIGUOUS"]}, candidates
    return {"status": "selected", "segment_id": eligible[0]["segment_id"], "reason_codes": []}, candidates
