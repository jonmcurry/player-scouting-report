"""Pure final selection from unchanged pose eligibility and exclusive direct bat evidence."""
from collections import Counter
from fractions import Fraction
from scripts.engine_v2.bat_track import track_bats
from scripts.engine_v2.identity import PROVISIONAL_SELECTION_THRESHOLDS as T


def _bat_key(row):
    # Match M2 geometry's pixel rounding, independent of endpoint order/knob identity.
    return row["frame"], tuple(sorted(tuple(round(v, 2) for v in p) for p in row["endpoints"]))


def ground_batter(pose_decision, candidates, segments, frames, bat_candidates, bat_failure):
    eligible = sorted((c for c in candidates if c["eligible"]), key=lambda c: c["segment_id"])
    if not eligible:
        return dict(pose_decision), [], track_bats(frames, {}, bat_candidates, bat_failure)

    by_id = {s["id"]: s for s in segments}
    runs = {c["segment_id"]: track_bats(
        frames, {r["index"]: r for r in by_id[c["segment_id"]]["rows"]}, bat_candidates, bat_failure)
        for c in eligible}
    uses = Counter(_bat_key(row) for rows, _, _ in runs.values() for row in rows if row["status"] == "detected")
    frame_map = {f["index"]: f for f in frames}
    evidence, fractions, spans = [], {}, {}
    for segment_id, (rows, _, _) in runs.items():
        detected = [r for r in rows if r["status"] == "detected"]
        exclusive = [r for r in detected if uses[_bat_key(r)] == 1]
        times = [frame_map[r["frame"]]["pts"] * Fraction(*frame_map[r["frame"]]["time_base"])
                 for r in exclusive]
        span = max(times) - min(times) if times else Fraction(0)
        fraction = Fraction(len(exclusive), len(frames)) if frames else Fraction(0)
        fractions[segment_id], spans[segment_id] = fraction, span
        evidence.append({"segment_id": segment_id, "segment_frames": len(by_id[segment_id]["rows"]),
                         "detected": len(detected), "exclusive": len(exclusive),
                         "shared": len(detected) - len(exclusive), "exclusive_fraction": float(fraction),
                         "exclusive_span_s": float(span)})

    if bat_failure or not any(e["exclusive"] for e in evidence):
        reason = "BAT_EVIDENCE_UNAVAILABLE" if bat_failure else "NO_EXCLUSIVE_BAT_EVIDENCE"
        decision = {**pose_decision, "basis": "pose_only",
                    "reason_codes": [*pose_decision["reason_codes"], reason]}
    else:
        ranked = sorted(fractions, key=lambda s: (-fractions[s], s))
        best = ranked[0]
        second = fractions[ranked[1]] if len(ranked) > 1 else Fraction(0)
        # Rational comparisons preserve the inclusive, predeclared boundaries exactly.
        if (fractions[best] >= Fraction(str(T["min_exclusive_fraction"]))
                and spans[best] >= Fraction(str(T["min_exclusive_span_s"]))
                and fractions[best] - second >= Fraction(str(T["min_exclusive_margin"]))):
            disagreement = pose_decision["status"] == "selected" and pose_decision["segment_id"] != best
            decision = {"status": "selected", "segment_id": best, "basis": "pose_and_bat",
                        "reason_codes": ["POSE_BAT_DISAGREEMENT"] if disagreement else []}
        else:
            decision = {"status": "ambiguous", "segment_id": None, "basis": "pose_and_bat",
                        "reason_codes": ["BAT_EVIDENCE_AMBIGUOUS"]}
    # Return the cached run for the final segment; never track that segment twice.
    bat_result = runs[decision["segment_id"]] if decision["status"] == "selected" else track_bats(
        frames, {}, bat_candidates, bat_failure)
    return decision, evidence, bat_result
