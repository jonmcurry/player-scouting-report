/**
 * Semantic (evidence-constraint) validation for AI swing-analysis drafts.
 *
 * validateSwingAnalysisResult() already guarantees the response is well-formed. That is not
 * enough: the first live AGY/Gemini evaluation (2026-09-25, ab1_hit) returned schema-valid JSON
 * that marked a single-swing observation "high" confidence, blamed a "poor pitch location" the
 * model was never given, asserted "weak contact" although the outcome was withheld, scored
 * Follow-through with no follow-through still supplied, and cited a methodology record whose own
 * "does not apply when" names game situations. Every rule below is enforced here, in code, and
 * not only in the prompt.
 *
 * Behavior: violations are collected and the whole response is rejected with a
 * SemanticValidationError (the same fail-whole-run contract the structural validator uses, so a
 * rejected response makes zero database writes). Nothing is repaired, downgraded or dropped:
 * silently "fixing" a response would store a claim the model never made, and one invalid piece
 * (e.g. a posture claim) can contaminate others (the contact-point score built on it).
 */
import type { PitchContext, SwingContext } from "./analysisContext.js";
import type { ChecklistDraft, CompDraft, DrillDraft, IssueDraft } from "./swingAnalysisShared.js";
import { CHECKPOINT_EVIDENCE_TIERS, type CheckpointEvidenceTier } from "../../types/scouting.js";

export class SemanticValidationError extends Error {
  constructor(readonly violations: string[]) {
    super(`AI response failed semantic validation (${violations.length}): ${violations.join("; ")}`);
    this.name = "SemanticValidationError";
  }
}

/** What the model was actually given - the only facts a draft may assert. */
export interface ValidationEvidence {
  pitch: PitchContext;
  frameNames: string[];
  /** does_not_apply_when of each methodology claim offered this run, keyed by claim id. */
  claimExclusions?: Record<string, string>;
}

// Checkpoints whose AI score is rejected on every analyzer path. Hip-shoulder separation is
// measured by the pipeline but has no validated angle-to-score rubric
// (scripts/pose3d/pose3d_to_checklist.py: "numbers yes, score no"), so no 1/2/3 score is accepted;
// any future measurement handling stays separate from checklist scoring.
const NOT_AI_SCORABLE: Record<string, string> = {
  "hip-shoulder-sep": "the pipeline measures it but has no validated angle-to-score rubric",
};
// Swing decisions judge pitch selection, which cannot be judged without knowing where the pitch was.
const NEEDS_PITCH_LOCATION = new Set(["swing-decisions"]);

/**
 * Evidence a checkpoint needs before it may be scored, derived from the shared tier definition
 * (CHECKPOINT_EVIDENCE_TIERS): a single-instant or single-angle checkpoint needs the still of its
 * phase; a whole-swing checkpoint cannot be scored from phase stills at all.
 */
export function checkpointEvidence(slug: string): { tier: CheckpointEvidenceTier; phases: string[]; pitchLocation: boolean; notScorable: string | null } | null {
  const def = CHECKPOINT_EVIDENCE_TIERS[slug];
  if (!def) return null;
  return {
    tier: def.tier,
    phases: def.phase ? [def.phase.replace(/-/g, "_")] : [],
    pitchLocation: NEEDS_PITCH_LOCATION.has(slug),
    notScorable: NOT_AI_SCORABLE[slug] ?? null,
  };
}

const PHASE_STILL = /^phase_([a-z_-]+)\.(png|jpe?g)$/i;

/**
 * The swing phases the supplied stills cover, from extractPhaseStills()'s `phase_<slug>.png`
 * names. When any phase still is present, coverage comes ONLY from the phase stills - other images
 * in the same set add no phase coverage and do not switch the check off. Returns null (whole clip,
 * no phase can be ruled out by name) only when there are zero phase stills: a dense frame_###.png
 * sequence, or no frame names recorded at all (only the manual --claudeDraft path; the live
 * analyzers refuse to run without frames).
 */
export function suppliedPhases(frameNames: string[]): Set<string> | null {
  const phases = new Set<string>();
  for (const name of frameNames) {
    const m = PHASE_STILL.exec(name);
    if (m) phases.add(m[1]!.toLowerCase().replace(/-/g, "_"));
  }
  return phases.size ? phases : null;
}

/**
 * The structured, known pitch location, or null. Only pitch_zone counts: the coach app records it
 * from a 9-zone grid and the schema constrains it to 1-9. pitch.location is free text - a legacy
 * carry-over ("From earlier entry") or the manual CLI's --pitchContext string - so "", whitespace,
 * "unknown", placeholders and arbitrary prose are never treated as known location evidence.
 */
export function knownPitchZone(p: PitchContext): number | null {
  return typeof p.zone === "number" && Number.isInteger(p.zone) && p.zone >= 1 && p.zone <= 9 ? p.zone : null;
}
export const pitchLocationKnown = (p: PitchContext) => knownPitchZone(p) !== null;

/**
 * The recorded cell of the coach app's 9-zone strike-zone grid - the same derivation as
 * coach/components/pitchZonePicker.js zoneLabel() (1-3 High, 4-6 Middle, 7-9 Low; each row
 * In/Mid/Out, batter-relative labels) and ux.md step 3B. The grid covers the strike zone only
 * (coach/atbat.html: "Strike zone only - leave blank for pitches outside it").
 */
export function zoneCell(zone: number): { row: "high" | "middle" | "low"; col: "in" | "mid" | "out" } {
  return { row: (["high", "middle", "low"] as const)[Math.floor((zone - 1) / 3)]!, col: (["in", "mid", "out"] as const)[(zone - 1) % 3]! };
}

// With a recorded zone the pitch was inside the strike-zone grid, so these contradict it.
const OUTSIDE_STRIKE_ZONE: RegExp[] = [/\b(out of|outside|off) the (strike )?(zone|plate)\b/i];
// Directional claims that name the OPPOSITE side of the recorded cell (In vs Out, High vs Low).
// Middle/Mid cells contradict nothing: "outside pitch" can mean the outer part of the zone.
const DIRECTION_CONTRADICTIONS: { when: (c: ReturnType<typeof zoneCell>) => boolean; re: RegExp }[] = [
  { when: (c) => c.col === "in", re: /\b(outside|away)[- ](pitch(es)?|ball|strike)\b|\b(low|high|up|down) and (away|out)\b/i },
  { when: (c) => c.col === "out", re: /\binside[- ](pitch(es)?|ball|strike)\b|\b(low|high|up|down) and in\b/i },
  { when: (c) => c.row === "high", re: /\blow[- ](pitch(es)?|ball|strike)\b|\b(low|down) and (away|in|out)\b/i },
  { when: (c) => c.row === "low", re: /\bhigh[- ](pitch(es)?|ball|strike)\b|\b(high|up) and (away|in|out)\b/i },
];

// Outcomes that are always a take (no swing) - mirrors coach/components/developmentLogic.js
// swungFromOutcome(). An explicit `swung` value always wins over the outcome.
const NO_SWING_OUTCOMES = new Set(["ball", "called_strike", "hit_by_pitch", "take"]);
const isTake = (p: PitchContext) => p.swung === false || (p.swung === null && p.outcome !== null && NO_SWING_OUTCOMES.has(p.outcome));
const outcomeIs = (...values: string[]) => (p: PitchContext) => p.outcome !== null && values.includes(p.outcome);
const never = () => false;

// Language that asserts where the pitch was (or that the hitter chased/reached for it).
const PITCH_LOCATION_TERMS: RegExp[] = [
  /\b(outside|inside|high|low|middle|away)[- ](pitch(es)?|ball|strike)\b/i,
  /\b(low|high|up|down) and (away|in|out)\b/i,
  /\bchas(e|ed|es|ing)\b/i,
  /\breach(ed|es|ing)?\s+(out\s+)?(for|after|at)\s+(an?|the|that|this)?\s*(\w+\s+)?(pitch(es)?|ball)\b/i,
  /\bpitch (location|placement)\b/i,
  /\b(poor|bad|tough|good|hittable|borderline|wild|chase)\s+pitch(es)?\b/i,
  /\b(out of|outside|off) the (strike )?(zone|plate)\b/i,
];

// Pitch types, each with the normalized pitch_type values that support it (a category is supported
// by any of its members).
const PITCH_TYPES: { re: RegExp; supportedBy: string[] }[] = [
  { re: /\bchange[- ]?ups?\b/i, supportedBy: ["changeup"] },
  { re: /\bcurve ?balls?\b/i, supportedBy: ["curveball"] },
  { re: /\bdrop ?balls?\b/i, supportedBy: ["dropball"] },
  { re: /\brise ?balls?\b/i, supportedBy: ["riseball"] },
  { re: /\bscrew ?balls?\b/i, supportedBy: ["screwball"] },
  { re: /\bfast ?balls?\b/i, supportedBy: ["fastball"] },
  { re: /\boff[- ]?speed\b/i, supportedBy: ["changeup", "curveball", "dropball", "riseball", "screwball", "offspeed"] },
  { re: /\bbreaking balls?\b/i, supportedBy: ["curveball", "dropball", "riseball", "screwball", "breakingball"] },
];

// Outcome language, each with the recorded pitch facts that make it true. The schema records only
// ball / called_strike / swinging_strike / foul / ball_in_play / hit_by_pitch / take / other (+ swung)
// - never contact quality or the batted-ball result - so those claims are never supported.
const OUTCOMES: { re: RegExp; supported: (p: PitchContext) => boolean }[] = [
  { re: /\b(weak|hard|solid|poor|clean|square|flush|soft|good)\s+contact\b(?![- ]point)/i, supported: never },
  { re: /\b(mis-?hit|jammed|popped up|pop[- ]?up|pop fly|fly ?ball|ground ?ball|grounder|line ?drive|base hit|home run|homered)\b/i, supported: never },
  { re: /\b(got|get|gets|for|recorded) a hit\b/i, supported: never },
  { re: /\b(struck out|strike ?out)\b/i, supported: never },
  { re: /\b(whiff(ed)?|swung and missed|missed the ball)\b|\bswing(ing)?[- ](and|&)[- ]miss\b/i, supported: outcomeIs("swinging_strike") },
  { re: /\b(singled|doubled|tripled|drew a walk|base on balls|ball four)\b/i, supported: never },
  { re: /\b(hit|had|got|for|lined|blooped|legged out) an? (single|double|triple|homer)\b/i, supported: never },
  { re: /\bwalked\b(?! (through|into|up|back|toward|forward|over))|\bfor a walk\b/i, supported: never },
  { re: /\bfoul(ed|s)?\b(?![- ](line|pole|territory))/i, supported: outcomeIs("foul") },
  { re: /\bput (it|the ball) in play\b|\bball in play\b/i, supported: outcomeIs("ball_in_play") },
  { re: /\bhit by (the |a )?pitch\b/i, supported: outcomeIs("hit_by_pitch") },
  // A called strike must be recorded as one; a take (no swing) never implies it.
  { re: /\b(called (third )?strike|strike looking)\b/i, supported: outcomeIs("called_strike") },
  // "Took the pitch" is true of any recorded no-swing: an explicit swung=false, or a take outcome.
  { re: /\b(took (the|a|that) pitch|taken pitch|was a take)\b/i, supported: isTake },
];
// A general "why it may matter" consequence is not an assertion about this swing - but only when the
// hedge word comes before the claim in the same clause ("can lead to weaker contact"), not anywhere
// in the sentence ("It can happen, and it led to weak contact" still asserts).
const HEDGE = /\b(may|might|can|could|often|tends? to|risks?|would|if)\b/i;
// Saying a fact is unknown is not a claim about it ("Pitch location is unknown", "unknown pitch
// location"). The exemption covers only the phrase the uncertainty is attached to, never the rest of
// the clause ("location is unknown because she chased the outside pitch" still fails on "chased").
const DATA_WORD = String.raw`(?:data|information|info|details)`;
const COPULA = String.raw`(?:is|was|are|were|has been|had been)`;
// "<phrase> was not supplied" / "<phrase>: unknown" / "<phrase> data unavailable"
const UNCERTAIN_AFTER = new RegExp(String.raw`^\s*${DATA_WORD}?\s*[:\-]?\s*${COPULA}?\s*(?:unknown|not known|not recorded|not supplied|not provided|not available|unavailable|missing|not given|unclear)\b`, "i");
// "unknown <phrase>" / "without knowing the <phrase>"
const UNCERTAIN_BEFORE = /\b(unknown|unrecorded|unclear|without knowing( the)?|cannot tell( the)?|can'?t tell( the)?)\s+$/i;
// "No <phrase> was supplied" / "no <phrase> data" - the same statement in the other word order. Both
// halves are required, so an affirmative "she showed no chase" is not exempt.
const NO_BEFORE = /\bno\s+$/i;
const NO_AFTER = new RegExp(String.raw`^\s*(?:${DATA_WORD}\b|${COPULA}?\s*(?:supplied|recorded|provided|available|given|known|reported|entered)\b)`, "i");
// In prescriptive fields, only a definite reference to this swing's pitch/result is a claim
// ("fix the weak contact"); generic practice language ("line drive tee drill") is not.
const DEFINITE_REFERENCE = /\b(the|this|that|her|his|their)\s+$/i;

const CLAUSE_BREAK = /,|\b(?:and|but|so)\b/gi;
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

type FieldKind = "observed" | "prescriptive";

/** First phrase `re` claims in `text`. A phrase that is itself declared unknown is not a claim;
 * with allowHedged, a match is skipped when a hedge word precedes it in its own clause (bounded by
 * sentence punctuation, commas and and/but/so); in prescriptive fields only a definite reference to
 * this swing counts. */
function findPhrase(text: string, re: RegExp, opts: { allowHedged: boolean; kind: FieldKind }): string | null {
  for (const sentence of text.split(/[.;!?\n]+/)) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of sentence.matchAll(global)) {
      const before = sentence.slice(0, m.index);
      const breaksBefore = [...before.matchAll(CLAUSE_BREAK)];
      const clauseStart = breaksBefore.length ? breaksBefore.at(-1)!.index! + breaksBefore.at(-1)![0].length : 0;
      const after = sentence.slice(m.index! + m[0].length);
      if (UNCERTAIN_AFTER.test(after) || UNCERTAIN_BEFORE.test(before) || (NO_BEFORE.test(before) && NO_AFTER.test(after))) continue;
      if (opts.allowHedged && HEDGE.test(before.slice(clauseStart))) continue;
      if (opts.kind === "prescriptive" && !DEFINITE_REFERENCE.test(before)) continue;
      return m[0];
    }
  }
  return null;
}

export interface SemanticResult {
  noActionReason: string | null;
  checklist: ChecklistDraft[];
  issues: IssueDraft[];
  comps: CompDraft[];
  compNotes: string[];
  drills: DrillDraft[];
}

/** Every free-text field of a response, labelled - all of it can reach analysis state. "observed"
 * fields describe this swing; "prescriptive" fields describe practice or what to watch next. */
function textFields(result: SemanticResult): { where: string; field: string; text: string; kind: FieldKind }[] {
  const out: { where: string; field: string; text: string; kind: FieldKind }[] = [];
  if (result.noActionReason) out.push({ where: "response", field: "noActionReason", text: result.noActionReason, kind: "observed" });
  result.issues.forEach((issue, i) => {
    for (const field of ["issue", "seenInAtBats", "likelyCause", "effect", "evidence"] as const) out.push({ where: `issues[${i}]`, field, text: issue[field], kind: "observed" });
    for (const field of ["coachingCue", "suggestedDrill", "lookForNext"] as const) {
      const text = issue[field];
      if (text) out.push({ where: `issues[${i}]`, field, text, kind: "prescriptive" });
    }
  });
  result.checklist.forEach((entry, i) => out.push({ where: `checklist[${i}] (${entry.checkpointSlug})`, field: "notes", text: entry.notes, kind: "observed" }));
  result.compNotes.forEach((note, i) => out.push({ where: `compNotes[${i}]`, field: "note", text: note, kind: "observed" }));
  result.comps.forEach((c, i) => out.push({ where: `comps[${i}]`, field: "cue", text: c.cue, kind: "prescriptive" }));
  result.drills.forEach((d, i) => {
    out.push({ where: `drills[${i}]`, field: "title", text: d.title, kind: "prescriptive" });
    out.push({ where: `drills[${i}]`, field: "description", text: d.description, kind: "prescriptive" });
  });
  return out;
}

// Exclusion wording that an emergencySwingSuspected=true swing falls inside.
const EMERGENCY_EXCLUSION = /\b(emergency|protective|check[- ]swings?)\b/i;

/** Throws SemanticValidationError listing every violation; returns normally when there are none. */
export function assertSemanticallyValid(result: SemanticResult, evidence: ValidationEvidence): void {
  const violations: string[] = [];
  const locationKnown = pitchLocationKnown(evidence.pitch);
  const knownType = evidence.pitch.pitchType === null ? null : normalize(evidence.pitch.pitchType);
  const knownOutcome = evidence.pitch.outcome;
  const phases = suppliedPhases(evidence.frameNames);

  for (const { where, field, text, kind } of textFields(result)) {
    const zone = knownPitchZone(evidence.pitch);
    if (zone === null) {
      for (const re of PITCH_LOCATION_TERMS) {
        const t = findPhrase(text, re, { allowHedged: false, kind });
        if (t) { violations.push(`${where}.${field} asserts pitch location ("${t}") but pitch location is unknown`); break; }
      }
    } else {
      const cell = zoneCell(zone);
      for (const re of OUTSIDE_STRIKE_ZONE) {
        const t = findPhrase(text, re, { allowHedged: false, kind });
        if (t) violations.push(`${where}.${field} says "${t}" but the recorded zone ${zone} is inside the strike zone`);
      }
      for (const { when, re } of DIRECTION_CONTRADICTIONS) {
        if (!when(cell)) continue;
        const t = findPhrase(text, re, { allowHedged: false, kind });
        if (t) violations.push(`${where}.${field} says "${t}" but the recorded zone ${zone} is ${cell.row}, ${cell.col}`);
      }
    }
    for (const { re, supportedBy } of PITCH_TYPES) {
      const t = findPhrase(text, re, { allowHedged: false, kind });
      if (t && !(knownType && supportedBy.includes(knownType))) {
        violations.push(`${where}.${field} names pitch type "${t}" but the supplied pitch type is ${evidence.pitch.pitchType ?? "unknown"}`);
      }
    }
    for (const { re, supported } of OUTCOMES) {
      // `effect` is the "why it may matter" field: a hedged general consequence is allowed there.
      const t = findPhrase(text, re, { allowHedged: field === "effect", kind });
      if (t && !supported(evidence.pitch)) {
        const recorded = `outcome ${knownOutcome ?? "unknown"}, swung ${evidence.pitch.swung ?? "unknown"}`;
        violations.push(`${where}.${field} asserts this swing's outcome ("${t}") but the recorded pitch (${recorded}) does not support it`);
      }
    }
  }

  result.issues.forEach((issue, i) => {
    const where = `issues[${i}]`;
    // Policy rule 4: every run analyzes one swing; no rule permits "high" for a single swing.
    if (issue.confidence === "high") violations.push(`${where}.confidence is "high" but a single-swing observation may be at most "medium"`);
    // Policy rule 15: only a known pitch location can explain the movement or mark a chase/protective swing.
    if (!locationKnown && issue.contextExplainsIt) violations.push(`${where}.contextExplainsIt is true but pitch location is unknown`);
    if (!locationKnown && issue.emergencySwingSuspected) violations.push(`${where}.emergencySwingSuspected is true but pitch location is unknown`);
    // Policy rule 12: movement the pitch explains is not a development priority. Both flags together is a contradiction.
    if (issue.contextExplainsIt && issue.suggestPriority) violations.push(`${where}.suggestPriority is true but contextExplainsIt says the pitch explains the movement`);
    if (phases && issue.phase && !phases.has(issue.phase)) violations.push(`${where}.phase "${issue.phase}" has no supplied still`);
    // Policy rule 18, structurally checkable part: a claim excluded for emergency swings cannot back one.
    if (issue.emergencySwingSuspected) {
      for (const id of issue.knowledgeClaimIds) {
        const exclusion = evidence.claimExclusions?.[id];
        if (exclusion && EMERGENCY_EXCLUSION.test(exclusion)) violations.push(`${where} cites ${id}, whose own exclusion covers emergency/protective swings, on a swing flagged as one`);
      }
    }
  });

  result.checklist.forEach((entry, i) => {
    const where = `checklist[${i}] (${entry.checkpointSlug})`;
    const need = checkpointEvidence(entry.checkpointSlug);
    if (!need) violations.push(`${where} has no evidence requirement defined`);
    else if (need.notScorable) violations.push(`${where} is scored but is never AI-scored: ${need.notScorable}`);
    else {
      // Whole-swing checkpoints need the whole swing: phase stills (any number) are single instants.
      if (need.tier === "whole-swing" && phases) violations.push(`${where} is a whole-swing checkpoint but only phase stills were supplied`);
      const missing = phases ? need.phases.filter((p) => !phases.has(p)) : [];
      if (missing.length) violations.push(`${where} is scored but its required still(s) ${missing.join(", ")} were not supplied`);
      if (need.pitchLocation && !locationKnown) violations.push(`${where} is scored but pitch location is unknown`);
    }
  });

  if (violations.length) throw new SemanticValidationError(violations);
}

/**
 * Game-context exclusion in a methodology record's free-text "does not apply when". The frozen
 * k-0.x payload has no structured scope field, so this reads the record's own wording for the one
 * swing context HitterLoop can determine structurally (a game at-bat). Practice clips are not
 * filtered: the app cannot tell tee from toss from live practice pitching.
 */
const GAME_EXCLUSION = /\b(in-?game|games?|live[- ]pitch(ing|es)?|live at-?bats?)\b/i;

/**
 * True when the record's own "does not apply when" excludes this swing's context. An unknown
 * context fails closed: it is treated as possibly a game swing.
 */
export function methodologyExcludedForContext(doesNotApplyWhen: string, context: SwingContext | undefined): boolean {
  if (context === "practice") return false;
  return GAME_EXCLUSION.test(doesNotApplyWhen);
}

/** Human-readable evidence requirement for the prompt's checkpoint list. */
export function checkpointRequirement(slug: string, frameNames: string[], pitch: PitchContext): string {
  const need = checkpointEvidence(slug);
  if (!need) return "requires: undefined - do not score";
  if (need.notScorable) return `never AI-scored: ${need.notScorable} - do not score`;
  const phases = suppliedPhases(frameNames);
  const wholeSwing = need.tier === "whole-swing";
  const parts = [...(wholeSwing ? ["whole-swing frames (not phase stills)"] : []), ...need.phases.map((p) => `${p} still`), ...(need.pitchLocation ? ["known pitch location"] : [])];
  const missing = [
    ...(wholeSwing && phases ? ["only phase stills were supplied"] : []),
    ...(phases ? need.phases.filter((p) => !phases.has(p)).map((p) => `${p} still`) : []),
    ...(need.pitchLocation && !pitchLocationKnown(pitch) ? ["known pitch location"] : []),
  ];
  return `requires: ${parts.join(" + ")}${missing.length ? ` - NOT SUPPLIED (${missing.join(", ")}): do not score` : ""}`;
}
