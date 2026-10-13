import { CLAIM_REQUIREMENTS } from "./claimRequirements.ts";
import { PROPOSED_CLAIMS_VERSION } from "./version.ts";
import { fraction, index, integer, object } from "./validation.ts";
import type { BodyPart, ClaimSufficiency, Concept, EvidenceEvent, FrameIdentity, PhaseSlug } from "./types.ts";

function frame(value: unknown): value is FrameIdentity {
  const v = object(value);
  return index(v.frame_index) && integer(v.pts);
}
function same(a: unknown, b: FrameIdentity): boolean {
  return frame(a) && a.frame_index === b.frame_index && a.pts === b.pts;
}
/** Supplied still/zoom/sequence identities and visibility must refer to this
 * same source/window. The later media adapter owns that provenance, not V3.
 * Evaluates availability only; all requirements remain proposed. */
export function assessSufficiency(concept: Concept, _phase: PhaseSlug | null, supplied: unknown,
  visibility: unknown, events: unknown): ClaimSufficiency {
  const result: ClaimSufficiency = { concept, status: "insufficient", missing: [], requiredEvents: [],
    claimsVersion: PROPOSED_CLAIMS_VERSION, requirementStatus: "proposed", reviewApproval: null };
  if (!Object.hasOwn(CLAIM_REQUIREMENTS, concept)) { result.missing.push("unknown_concept"); return result; }
  const rule = CLAIM_REQUIREMENTS[concept], eventMap = object(events), media = object(supplied);
  if (rule.disabledReason) result.missing.push(rule.disabledReason);
  if (rule.cameraProfiles !== null && !rule.cameraProfiles.includes(String(media.captureProfile))) {
    result.missing.push("camera_profile_not_supported");
  }
  const requiredFrames: FrameIdentity[] = [];
  const chosen: { event: EvidenceEvent; frame: FrameIdentity }[] = [];
  let previousFrame = -1, previousPts: number | null = null, base: unknown;
  for (const alternatives of rule.events) {
    const event = alternatives.find(name => {
      const v = object(eventMap[name]);
      return v.event === name && v.status === "pass" && index(v.rawFrame) && integer(v.rawPts)
        && typeof v.rawTimeBase === "string";
    });
    if (!event) { result.missing.push(`event:${alternatives.join("|")}`); continue; }
    const value = object(eventMap[event]);
    const identity = { frame_index: value.rawFrame as number, pts: value.rawPts as number };
    if (identity.frame_index < previousFrame || (previousPts !== null && (identity.pts < previousPts
      || (identity.frame_index === previousFrame) !== (identity.pts === previousPts)))
      || (base !== undefined && base !== value.rawTimeBase)) result.missing.push("event_order_or_time_base");
    previousFrame = identity.frame_index; previousPts = identity.pts; base = value.rawTimeBase;
    result.requiredEvents.push(event); chosen.push({ event, frame: identity }); requiredFrames.push(identity);
  }
  const stills = object(media.stills), zooms = object(media.zooms);
  const still = () => chosen.length > 0 && chosen.every(({ event, frame: f }) => same(stills[event], f));
  const needSequence = rule.images === "sequence" || rule.images === "sequence_extension_zoom"
    || (rule.images === "still_or_sequence" && !still());
  if ((rule.images === "still" || rule.images === "still_zoom") && !still()) result.missing.push("still");
  if (rule.images === "still_zoom") {
    if (!chosen.length || !chosen.every(({ event, frame: f }) => same(zooms[event], f))) result.missing.push("zoom");
  }
  if (rule.images === "sequence_extension_zoom") {
    const extension = chosen.find(v => v.event === "extension");
    if (!extension || !same(zooms.extension, extension.frame)) result.missing.push("zoom:extension");
  }
  if (needSequence) {
    const sequence = media.sequence;
    if (!Array.isArray(sequence) || sequence.length < rule.minSequenceFrames
      || !sequence.every(frame) || sequence.some((v, i) => i > 0
        && (v.frame_index <= sequence[i - 1]!.frame_index || v.pts <= sequence[i - 1]!.pts))) {
      result.missing.push("sequence");
    } else if (!chosen.length || chosen.some(v => sequence[0]!.frame_index > v.frame.frame_index
      || sequence[0]!.pts > v.frame.pts || sequence[sequence.length - 1]!.frame_index < v.frame.frame_index
      || sequence[sequence.length - 1]!.pts < v.frame.pts
      || sequence.some(f => Math.sign(f.frame_index - v.frame.frame_index) !== Math.sign(f.pts - v.frame.pts)))) {
      result.missing.push("sequence_coverage");
    } else requiredFrames.push(...sequence);
  }
  const uniqueFrames = [...new Map(requiredFrames.map(f => [f.frame_index, f])).values()];
  const samples = Array.isArray(visibility) ? visibility : [];
  for (const [part, threshold] of Object.entries(rule.visibility) as [BodyPart, number | true][]) {
    let sum = 0, valid = uniqueFrames.length > 0;
    for (const identity of uniqueFrames) {
      const matches = samples.filter(sample => same(sample, identity));
      const value = object(object(matches[0]).parts)[part];
      if (matches.length !== 1 || (threshold === true ? value !== true : !(typeof value === "boolean" || fraction(value)))) {
        valid = false; continue;
      }
      // Sum distance from the boundary instead of repeatedly adding (e.g.) 0.8;
      // identical boundary samples must not fail through floating-point drift.
      const availability = value === true ? 1 : value === false ? 0 : value as number;
      sum += availability - (threshold === true ? 1 : threshold);
    }
    if (!valid || sum < 0) result.missing.push(`${part}_visibility`);
  }
  result.missing = [...new Set(result.missing)];
  result.status = result.missing.length ? "insufficient" : "sufficient";
  return result;
}
