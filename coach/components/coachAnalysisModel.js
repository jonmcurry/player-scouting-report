export const PHASES = Object.freeze([
  ["legacy_stance", "Stance"], ["legacy_load", "Load"],
  ["legacy_stride", "Stride"], ["contact_estimate", "Contact estimate"],
  ["extension", "Extension"], ["legacy_follow_through", "Finish"],
]);

export function phaseBySlug(report, slug) {
  return (report?.phases ?? []).find((phase) => phase.slug === slug) ?? null;
}

export function comparableSetup(report, candidate) {
  const reasons = [];
  if (!candidate || candidate.clipId === report?.clipId) reasons.push("Choose another swing");
  if (!report?.sport || report.sport !== candidate?.sport) reasons.push("Different sport");
  if (!report?.context?.intent || report.context.intent === "unknown"
    || report.context.intent !== candidate?.intent) reasons.push("Swing intent unavailable or different");
  if (!report?.environment || report.environment !== candidate?.environment)
    reasons.push("Game and practice stay separate");
  if (!report?.context?.environment || report.context.environment === "unknown"
    || report.context.environment !== candidate?.contextEnvironment)
    reasons.push("Batting environment unavailable or different");
  if (!report?.capture?.profile || !candidate?.profile
    || report.capture.profile === "unknown_imported" || report.capture.profile !== candidate.profile)
    reasons.push("Camera view unavailable or different");
  if (!report?.capture?.orientation || !candidate?.orientation
    || report.capture.orientation === "unknown" || report.capture.orientation !== candidate.orientation)
    reasons.push("Orientation unavailable or different");
  if (report?.capture?.state !== "supported" || candidate?.captureState !== "supported")
    reasons.push("Camera setup needs review");
  return { compatible: reasons.length === 0, reasons };
}

export function syncPoints(report, candidate, slug) {
  if (!comparableSetup(report, candidate).compatible) return null;
  const current = phaseBySlug(report, slug)?.time;
  const other = candidate?.phases?.[slug];
  if (current === null || current === undefined || other === null || other === undefined) return null;
  const first = Number(current), second = Number(other);
  return Number.isFinite(first) && first >= 0 && Number.isFinite(second) && second >= 0
    ? [first, second] : null;
}

export function phaseAvailability(phase) {
  if (!phase || phase.frame === null || phase.time === null
    || phase.frame === undefined || phase.time === undefined) return "Unavailable in this video";
  if (phase.visibility === "unavailable") return "Located; visual detail unavailable";
  return phase.visibility === "partial" ? "Partly visible" : "Visible";
}
