### S0-04: Clip-level evidence assessment (pure module)

**New file:** `src/services/development/evidenceGate.ts`. It is pure (no I/O) and importable from Node and Deno.

```ts
export const EVIDENCE_GATE_VERSION = "gate-0.1.0";

/** Inputs are extracted from existing pipeline artifacts; no 3D field is accepted (R2). */
export interface ClipEvidenceSignals {
  engineVersion: string;
  /** detect_2d bat_evidence */
  batterSelection: { usedFallback: boolean; trackFrames: number; batEvidenceFrames: number };
  /** metrics.json */
  contact: { frame: number | null; confidence: "high" | "low" | null };
  phases: Partial<Record<PhaseSlug, { frame: number | null; confidence: "high" | "low" | null }>>;
  /** Computed from pose_2d.json over the swing window [load-0.1s, last phase+0.4s] (same window extract.ts uses) */
  swingWindow: {
    frames: number;
    batterTrackedFraction: number;      // frames with keypoints / frames
    identityJumpFraction: number;       // frames whose body centre jumps > MAX_JUMP * body height from the anchor (subjectBox.ts rule)
    coreKeypointFraction: number;       // frames with shoulders+hips >= 0.3 conf
    batDetectedFraction: number;        // bat_path frames with a tip
  } | null;
  /** extract.ts result */
  aiInputs: { phaseStills: string[]; zooms: string[]; sequenceFrames: number; sequenceSkipped: string | null };
  /** Capture assessment (00056), if available; informational in gate-0.1.0 */
  captureProfile: string | null;
}

export type ClipGateReason =
  | "batter_selection_fallback" | "contact_not_located" | "contact_low_confidence"
  | "batter_not_tracked_in_swing" | "possible_identity_switch" | "swing_window_unavailable"
  | "no_batter_crop" | "engine_unknown";

export interface ClipEvidenceDecision {
  gateVersion: string;
  /** "eligible": AI may run and its claims proceed to claim-level checks. "withhold": no coaching claim may be shown. */
  status: "eligible" | "withhold";
  reasons: ClipGateReason[];            // empty when eligible
  familyReason: "batter_unclear" | "swing_unclear" | null; // maps to plainFailureReason copy
  thresholds: Record<string, number>;   // the exact values applied, recorded for audit
  signals: ClipEvidenceSignals;         // recorded verbatim
}

export function assessClipEvidence(signals: ClipEvidenceSignals): ClipEvidenceDecision;
export function extractClipEvidenceSignals(args: {
  pose2d: unknown; batPath: unknown; metrics: unknown; aiInputs: ClipEvidenceSignals["aiInputs"]; captureProfile: string | null;
}): ClipEvidenceSignals;   // pure; parsing only
```

**gate-0.1.0 rules.** Values are provisional and conservative. Each is replaced by a Stage-1-calibrated value (S1-09), and none is claimed as validated.

| Rule | Withhold when | Rationale (audit ref) |
|---|---|---|
| G1 | `batterSelection.usedFallback` | F-09: the analysed person may not be the batter |
| G2 | `batEvidenceFrames < max(5, 0.02 * trackFrames)` | Same signal as `metrics.py:880-883` "likely framing issue" |
| G3 | `contact.frame == null` | Nothing anchors the stills |
| G4 | `contact.confidence !== "high"` | F-02: low-confidence contact currently flows to parents |
| G5 | `swingWindow == null` or `batterTrackedFraction < 0.9` | Stills or sequence may not show the batter |
| G6 | `identityJumpFraction > 0.05` | `subjectBox.ts:77-78` documents real identity jumps |
| G7 | `zooms` lacks `zoom_contact` | The batter could not be boxed at the anchor instant |
| G8 | `engineVersion` not in the gate's `SUPPORTED_ENGINES` list (`["baseline-1.0.0"]` in gate-0.1.0) → reason `engine_unknown` | Thresholds are only meaningful for the engine they were set on. A new engine must ship with its own gate version. |

**Explicitly not used (R2):** `reconstruction_reliable`, `pose3d_coverage`, any 3D angle, `analysis_quality.reconstruction`.

**Family-facing reasons:** G1/G2/G6/G7 → `batter_unclear` ("We couldn't find the batter clearly."). G3/G4/G5 → `swing_unclear`. Both reuse existing copy in `reportAssembly.ts` `plainFailureReason`.

**Acceptance tests** (`src/services/development/evidenceGate.test.ts`):
- One test per rule, plus combined reasons.
- Boundary values (exactly at threshold).
- Missing optional inputs fail closed (null signals → withhold with `swing_window_unavailable`).
- A 3D-only degradation (fixture with `pose3d_coverage: 0`, `reconstruction_reliable: false`) still passes. This is the R2 test.
- `extractClipEvidenceSignals` round-trips synthetic `pose_2d.json`/`bat_path.json`/`metrics.json` fixtures stored at `src/services/development/fixtures/evidence/*.json` (synthetic; no real child data).
- A determinism test: same input → identical decision object (stable reason ordering).

**Rollback:** module unused when both gate modes are `off`.

**Size:** M.

---
