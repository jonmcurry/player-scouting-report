/**
 * Development-only gate and pre-storage qualification for v2 engine coaching (M4).
 * The gate decides whether any v2 evidence may reach an AI provider at all; qualification decides which
 * validated findings may be stored, with a plain-English reason for every suppression. This is an
 * experimental qualification, not calibrated reliability: the AI's own confidence never makes a finding
 * displayable, and nothing here upgrades confidence.
 */
import type { SwingAnalysisResult } from "../ai/swingAnalysisShared.js";
import { V2_BAT_EVENTS, type V2EvidencePackage } from "../ai/v2EvidencePackage.js";

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): Record<string, unknown> => record(v) ? v : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];

/** Providers with an evidence-addendum hook. Gemini has none, so v2 never uses it. */
export const V2_PROVIDERS = Object.freeze({ "agy-cli": "agy", "claude-cli": "claude" } as const);

export function v2CoachingEligibility(artifacts: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env):
  { eligible: boolean; reasons: string[]; provider: "agy" | "claude" | null } {
  const reasons: string[] = [];
  const status = obj(artifacts["pipeline_status.json"]), metrics = obj(artifacts["metrics.json"]);
  const decision = obj(obj(obj(artifacts["tracks.json"]).grounding).final_decision);
  const diagnostics = obj(metrics.diagnostics);
  // Explicit opt-in first: without it no v2 footage or evidence may reach any provider.
  if (env.ENGINE_V2_AI !== "enabled") reasons.push("V2_AI_NOT_ENABLED");
  const provider = (V2_PROVIDERS as Record<string, "agy" | "claude">)[env.AI_ANALYZER ?? ""] ?? null;
  if (!provider) reasons.push("V2_PROVIDER_UNSUPPORTED");
  if (status.status !== "complete") reasons.push("ENGINE_NOT_COMPLETE");
  if (decision.status !== "selected") reasons.push("NO_SELECTED_BATTER");
  else if (decision.basis !== "pose_and_bat") reasons.push("IDENTITY_NOT_BAT_GROUNDED");
  if (list(decision.reason_codes).includes("POSE_BAT_DISAGREEMENT") || diagnostics.possible_batter_selection_conflict === true) {
    reasons.push("POSSIBLE_BATTER_CONFLICT");
  }
  if (list(diagnostics.reason_codes).length) reasons.push("UNSUPPORTED_CAMERA_GEOMETRY");
  if (obj(metrics.swing_detection).status !== "swing_candidate") reasons.push("NO_SWING_CANDIDATE");
  const citable = list(metrics.events).map(obj).some(e => e.status === "available" && e.downstream_use === "experimental"
    && Number.isSafeInteger(obj(obj(metrics.phases)[phaseOf(String(e.id)) ?? ""]).frame));
  if (!citable) reasons.push("NO_SUPPORTED_EVENT");
  return { eligible: reasons.length === 0, reasons, provider };
}

const PHASE_OF: Readonly<Record<string, string>> = { stance_set: "stance", load_peak_estimate: "load", foot_plant: "stride",
  impact_estimate: "contact", extension: "extension", finish: "follow_through" };
const phaseOf = (eventId: string): string | null => PHASE_OF[eventId] ?? null;

/** The engine supplies no measurements, so any digit or degree sign in a finding is a numeric claim, once
 * cited image names (e.g. swing_seq_04.png) are removed. Fails closed on incidental numbers too. */
const IMAGE_NAME = /\b(?:phase|zoom)_[a-z_-]+(?:\.(?:png|jpe?g))?\b|\bswing_seq_\d+(?:\.(?:png|jpe?g))?\b/gi;
const numericClaim = (text: string) => /\d|°/.test(text.replace(IMAGE_NAME, ""));
const CONTACT = /\b(?:mak(?:e|es|ing)|made)\s+contact\b|\bcontact\s+with\s+the\s+ball\b|\bat\s+contact\b|\bhit(?:s|ting)?\s+the\s+ball\b|\bbarrell?ed\b|\bsquared?\s+(?:it\s+)?up\b|\b(?:solid|weak|hard|good|clean|poor|loud)\s+contact\b|\bfoul(?:ed)?\b|\bline\s+drive\b|\bball\s+(?:flight|off\s+the\s+bat)\b|\b(?:ground|fly|pop)\s+ball\b|\bpop(?:ped)?\s+(?:up|fly)\b|\bwhiff(?:ed|s)?\b|\b(?:swing|swung|swinging)\s+and\s+(?:a\s+)?miss(?:ed|es)?\b|\bgrounders?\b|\bmissed\s+the\s+ball\b|\bbase\s+hit\b|\binto\s+the\s+gap\b|\bhome\s+run\b/i;
const HAND_PATH = /\bhand\s+path\b|\bknob\b/i;
const CAUSAL = /\b(?:causes|caused|will\s+cause|guarantees?|definitely|always\s+(?:leads|results))\b/i;

export const SUPPRESSION_EXPLANATIONS: Readonly<Record<string, string>> = Object.freeze({
  EVENT_REFERENCE_INVALID: "It cites a swing moment the engine did not supply.",
  EVENT_PHASE_MISMATCH: "Its swing phase does not match the moment it cites.",
  NO_IMAGE_FOR_EVENT: "There is no still image of the moment it cites.",
  BAT_NOT_DIRECTLY_OBSERVED: "The bat was not directly seen at the moment it cites.",
  POSE_NOT_OBSERVED: "The batter's body was not tracked at the moment it cites.",
  UNSUPPORTED_BASIS: "It relies on evidence other than the video.",
  NUMERIC_CLAIM: "It states a measurement the video analysis does not provide.",
  CONTACT_CLAIM: "It describes ball contact, which the analysis cannot confirm.",
  HAND_PATH_CLAIM: "It describes hand path or the knob, which the analysis cannot measure reliably.",
  CAUSAL_CLAIM: "It states a cause as certain instead of describing what is visible.",
  NOT_SUPPORTED_IN_V2: "This kind of output is not used by the experimental analysis.",
  SUMMARY_UNSUPPORTED_CLAIM: "The summary or no-action reason made a claim the evidence cannot support, so this analysis was withheld.",
});

export interface V2Decision { kind: "summary" | "strength" | "issue" | "checklist" | "comp" | "compNote" | "drill"; index: number;
  displayed: boolean; reasons: string[]; explanation: string | null; supportingEvents: string[] }
export interface V2Qualification {
  version: "v2-qualification-1.0.0"; label: "experimental_qualification"; withheld: string | null;
  decisions: V2Decision[]; displayedStrengths: SwingAnalysisResult["strengths"]; displayedIssues: SwingAnalysisResult["issues"];
}

function textReasons(texts: Array<string | undefined>): string[] {
  const joined = texts.filter(Boolean).join("\n");
  return [numericClaim(joined) && "NUMERIC_CLAIM", CONTACT.test(joined) && "CONTACT_CLAIM",
    HAND_PATH.test(joined) && "HAND_PATH_CLAIM"].filter(Boolean) as string[];
}

function evidenceReasons(events: string[] | undefined, phase: string | undefined, pkg: V2EvidencePackage): string[] {
  const reasons: string[] = [];
  const cited = events ?? [];
  if (!cited.length || cited.some(e => !pkg.supportedEvents.includes(e))) reasons.push("EVENT_REFERENCE_INVALID");
  if (phase && !cited.some(e => phaseOf(e) === phase)) reasons.push("EVENT_PHASE_MISMATCH");
  for (const id of cited) {
    const still = pkg.images.find(i => i.kind === "phase_still" && i.eventId === id);
    if (!still) { reasons.push("NO_IMAGE_FOR_EVENT"); continue; }
    if (V2_BAT_EVENTS.has(id) ? still.batObservation !== "direct" : !still.batterPose) {
      reasons.push(V2_BAT_EVENTS.has(id) ? "BAT_NOT_DIRECTLY_OBSERVED" : "POSE_NOT_OBSERVED");
    }
  }
  return [...new Set(reasons)];
}

const decide = (kind: V2Decision["kind"], index: number, reasons: string[], supportingEvents: string[] = []): V2Decision => ({
  kind, index, displayed: reasons.length === 0, reasons,
  explanation: reasons.length ? reasons.map(r => SUPPRESSION_EXPLANATIONS[r] ?? r).join(" ") : null, supportingEvents });

export function qualifyV2Findings(result: SwingAnalysisResult, pkg: V2EvidencePackage): V2Qualification {
  const base = { version: "v2-qualification-1.0.0" as const, label: "experimental_qualification" as const };
  // The summary and no-action reason are stored as written, so a contact, numeric, hand-path or causal claim
  // in either cannot be repaired: the whole run is withheld.
  const runText = [result.summary ?? undefined, result.noActionReason ?? undefined];
  const summaryReasons = [...textReasons(runText), ...(CAUSAL.test(runText.filter(Boolean).join("\n")) ? ["CAUSAL_CLAIM"] : [])];
  if (summaryReasons.length) {
    // Recorded locally with its reasons; the withheld run itself makes no database write.
    const summary = decide("summary", 0, summaryReasons);
    summary.explanation = `${SUPPRESSION_EXPLANATIONS.SUMMARY_UNSUPPORTED_CLAIM} ${summary.explanation}`;
    return { ...base, withheld: "SUMMARY_UNSUPPORTED_CLAIM", decisions: [summary], displayedStrengths: [], displayedIssues: [] };
  }
  const decisions: V2Decision[] = [];
  result.strengths.forEach((s, i) => decisions.push(decide("strength", i, [
    ...evidenceReasons(s.supportingEvents, s.phase, pkg), ...textReasons([s.text, s.evidence]),
    ...(CAUSAL.test([s.text, s.evidence].join("\n")) ? ["CAUSAL_CLAIM"] : []),
  ], s.supportingEvents)));
  result.issues.forEach((issue, i) => decisions.push(decide("issue", i, [
    ...evidenceReasons(issue.supportingEvents, issue.phase, pkg),
    ...(issue.basis !== "video" ? ["UNSUPPORTED_BASIS"] : []),
    ...textReasons([issue.issue, issue.evidence, issue.effect, issue.likelyCause, issue.coachingCue, issue.lookForNext, issue.seenInAtBats]),
    ...(CAUSAL.test([issue.issue, issue.evidence, issue.effect, issue.likelyCause, issue.coachingCue, issue.lookForNext].join("\n")) ? ["CAUSAL_CLAIM"] : []),
  ], issue.supportingEvents)));
  // Outputs without event citations are not qualified in v2 and are never stored.
  result.checklist.forEach((_, i) => decisions.push(decide("checklist", i, ["NOT_SUPPORTED_IN_V2"])));
  result.comps.forEach((_, i) => decisions.push(decide("comp", i, ["NOT_SUPPORTED_IN_V2"])));
  result.compNotes.forEach((_, i) => decisions.push(decide("compNote", i, ["NOT_SUPPORTED_IN_V2"])));
  result.drills.forEach((_, i) => decisions.push(decide("drill", i, ["NOT_SUPPORTED_IN_V2"])));
  const shown = (kind: V2Decision["kind"], i: number) => decisions.some(d => d.kind === kind && d.index === i && d.displayed);
  return { ...base, withheld: null, decisions,
    displayedStrengths: result.strengths.filter((_, i) => shown("strength", i)),
    displayedIssues: result.issues.filter((_, i) => shown("issue", i)) };
}

/** The stored result: qualified strengths/issues only; uncited output kinds dropped. */
export const NO_QUALIFIED_ISSUE_REASON = "No finding met the experimental evidence requirements for this swing.";

/** The stored result: qualified strengths/issues only; uncited output kinds dropped. If every issue was
 * suppressed, the run is stored as no-action-needed, never as "needs attention" with nothing listed. */
export function qualifiedResult(result: SwingAnalysisResult, q: V2Qualification): SwingAnalysisResult {
  const noIssues = q.displayedIssues.length === 0;
  return { ...result, strengths: q.displayedStrengths, issues: q.displayedIssues, checklist: [], comps: [], compNotes: [], drills: [],
    noActionNeeded: noIssues, noActionReason: noIssues ? (result.noActionNeeded ? result.noActionReason : NO_QUALIFIED_ISSUE_REASON) : null };
}
