import type { ObservationStatus } from "./types.js";

export interface Sample { value: number | null; confidence: number; status?: ObservationStatus }

/** Linear interpolation for short gaps only. Longer gaps stay model-inferred/missing, never invented. */
export function interpolateShortGaps(samples: Sample[], maxGapFrames = 4, minConfidence = 0.25): Sample[] {
  const out: Sample[] = samples.map((s) => ({ ...s, status: s.value !== null && s.confidence >= minConfidence ? "observed" : "missing" }));
  let i = 0;
  while (i < out.length) {
    if (out[i]!.status === "observed") { i++; continue; }
    const start = i;
    while (i < out.length && out[i]!.status !== "observed") i++;
    const end = i - 1;
    const gap = end - start + 1;
    if (start > 0 && i < out.length && gap <= maxGapFrames) {
      const a = out[start - 1]!.value!;
      const b = out[i]!.value!;
      for (let j = 0; j < gap; j++) {
        const alpha = (j + 1) / (gap + 1);
        out[start + j] = { value: a + (b - a) * alpha, confidence: Math.min(out[start - 1]!.confidence, out[i]!.confidence) * 0.75, status: "interpolated" };
      }
    }
  }
  return out;
}
