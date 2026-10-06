import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { GoogleGenAI } from "@google/genai";
import type { AnalysisInput } from "./analysisContext.js";
import { analyzeSwing } from "./geminiAnalyzer.js";
import { MIN_SWING_SEQUENCE_FRAMES, SemanticValidationError, checkpointEvidence, methodologyExcludedForContext, suppliedPhases, wholeSwingSupplied, zoneCell } from "./semanticValidation.js";
import { SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS, renderSwingAnalysisPrompt, validateSwingAnalysisResult, validationContext } from "./swingAnalysisShared.js";
import { CHECKPOINTS, CHECKPOINT_EVIDENCE_TIERS } from "../../types/scouting.js";
import { filterApplicableMethodology } from "../knowledge/methodologyRepository.js";
import type { MethodologyItem } from "../knowledge/methodologyTypes.js";

const UNKNOWN_PITCH = { location: null, zone: null, count: null, outcome: null, swung: null, pitchType: null };
const PHASE_STILLS = ["phase_contact.png", "phase_extension.png", "phase_load.png", "phase_stance.png"];

const input = (overrides: Partial<AnalysisInput> = {}, swing: Partial<AnalysisInput["swing"]> = {}): AnalysisInput => ({
  player: { sport: "softball", level: null, ageBand: null, bats: null, throws: null },
  pitch: UNKNOWN_PITCH,
  coachReviewedDecisions: [],
  swing: { frameNames: PHASE_STILLS, context: "game", pipelineVersion: "pose3d-live-1.0.0", metrics: {}, reconstructionSupplied: false, excludedMeasurements: [], ...swing },
  knowledgePack: "No approved claims.", knowledgeClaimIds: ["claim-ok"], knowledgeVersion: "k-0.2.0", ...overrides,
});

// A conservative, evidence-grounded observation that every rule accepts.
const issue = (extra: Record<string, unknown> = {}) => ({
  issue: "Front shoulder opens before the hands start forward", seenInAtBats: "this swing",
  likelyCause: "Upper body starts the swing before the lower half", effect: "This can make it harder to keep the barrel in the zone.",
  evidence: "Between the load and contact stills the front shoulder has turned toward first base while the hands are still back.",
  coachingCue: "Hit it to the middle of the field", lookForNext: "Front shoulder staying closed until the hands move",
  confidence: "low", phase: "contact", concept: "hip_shoulder_sequencing", basis: "video",
  contextExplainsIt: false, emergencySwingSuspected: false, knowledgeClaimIds: [], suggestPriority: false, ...extra,
});
const response = (extra: Record<string, unknown> = {}) => ({
  noActionNeeded: false, noActionReason: null,
  checklist: [{ checkpointSlug: "stance-setup", score: 3, notes: "Athletic base with visible knee flex." }],
  issues: [issue()], comps: [], compNotes: [], drills: [], ...extra,
});
const validate = (raw: unknown, i: AnalysisInput = input()) => validateSwingAnalysisResult(raw, { source: "gemini", aiModel: "m", ...validationContext(i) });
const rejects = (raw: unknown, pattern: RegExp, i: AnalysisInput = input()) =>
  assert.throws(() => validate(raw, i), (e: unknown) => e instanceof SemanticValidationError && pattern.test(e.message));

test("G: a conservative, evidence-grounded result still passes", () => {
  const result = validate(response());
  assert.equal(result.issues.length, 1);
  assert.equal(result.checklist[0]!.score, 3);
  assert.equal(result.issues[0]!.confidence, "low", "nothing is rewritten");
});

test("G: sparse outputs pass - no issues, no checklist, or noActionNeeded", () => {
  assert.doesNotThrow(() => validate(response({ issues: [], checklist: [] })));
  assert.doesNotThrow(() => validate({ ...response({ issues: [], checklist: [] }), noActionNeeded: true, noActionReason: "No meaningful mechanical issue is supported by this swing." }));
  assert.doesNotThrow(() => validate(response({ issues: [issue({ confidence: "medium" })] })), "medium stays allowed");
});

test("simplified report rejects an unsupported result claim in its summary", () => {
  rejects(response({ summary: "She hit a hard line drive to center field.", strengths: [] }), /response.summary asserts this swing's outcome/);
});

test("optional at-bat result supports only its broad label and never decides whether this swing happened", () => {
  const strikeout = input({ atBatResult: "strikeout" });
  assert.doesNotThrow(() => validate(response({ summary: "She struck out. Her setup stayed balanced." }), strikeout));
  rejects(response({ summary: "She took the pitch." }), /response.summary asserts this swing's outcome/, strikeout);
  const hit = input({ atBatResult: "hit" });
  assert.doesNotThrow(() => validate(response({ summary: "She got a hit. Her setup stayed balanced." }), hit));
  rejects(response({ summary: "She made hard contact." }), /response.summary asserts this swing's outcome/, hit);
});

test("simplified report strengths need a supplied phase and visible evidence", () => {
  assert.throws(() => validate(response({ summary: "She stayed balanced.", strengths: [{ text: "Balanced finish", evidence: "At finish", phase: "follow_through" }] })), /no supplied still/);
  assert.throws(() => validate(response({ summary: "She stayed balanced.", strengths: [{ text: "Balanced setup", evidence: "", phase: "stance" }] })), /visible evidence/);
  assert.doesNotThrow(() => validate(response({ summary: "She starts with a balanced stance.", strengths: [{ text: "Balanced stance", evidence: "Feet set under shoulders in the stance still", phase: "stance" }] })));
});

test("a displayed fix needs nonblank observation, evidence, cue, and next check", () => {
  for (const field of ["issue", "evidence", "coachingCue", "lookForNext"]) {
    assert.throws(() => validate(response({ issues: [issue({ [field]: "  " })] })),
      new RegExp(`issues\\[0\\]\\.${field} must not be blank`));
  }
});

test("A: a single-swing observation marked high confidence is rejected", () => {
  rejects(response({ issues: [issue({ confidence: "high" })] }), /confidence is "high"/);
});

test("B: unknown pitch context cannot explain the swing or flag an emergency swing", () => {
  rejects(response({ issues: [issue({ contextExplainsIt: true })] }), /contextExplainsIt is true but pitch location is unknown/);
  rejects(response({ issues: [issue({ emergencySwingSuspected: true })] }), /emergencySwingSuspected is true but pitch location is unknown/);
});

test("B: a pitch type alone does not establish location, so it cannot explain the swing", () => {
  const typeOnly = input({ pitch: { ...UNKNOWN_PITCH, pitchType: "changeup" } });
  rejects(response({ issues: [issue({ contextExplainsIt: true })] }), /contextExplainsIt is true but pitch location is unknown/, typeOnly);
});

test("B: supplied pitch context still allows both flags", () => {
  const known = input({ pitch: { ...UNKNOWN_PITCH, location: "low and away", zone: 9 } });
  const result = validate(response({ issues: [issue({ contextExplainsIt: true, emergencySwingSuspected: true, likelyCause: "Reaching for a low and away pitch" })] }), known);
  assert.equal(result.issues[0]!.contextExplainsIt, true);
});

test("rule 12: contextExplainsIt and suggestPriority together is a contradiction and is rejected", () => {
  const known = input({ pitch: { ...UNKNOWN_PITCH, location: "low and away", zone: 9 } });
  // 1. both true -> rejected
  rejects(response({ issues: [issue({ contextExplainsIt: true, suggestPriority: true })] }), /suggestPriority is true but contextExplainsIt says the pitch explains the movement/, known);
  // 2. context explains it, no priority suggested -> allowed (all other rules pass)
  assert.equal(validate(response({ issues: [issue({ contextExplainsIt: true, suggestPriority: false })] }), known).issues[0]!.contextExplainsIt, true);
  // 3. priority suggested, context does not explain it -> allowed when otherwise valid, rejected when not
  assert.equal(validate(response({ issues: [issue({ contextExplainsIt: false, suggestPriority: true })] })).issues[0]!.suggestPriority, true);
  rejects(response({ issues: [issue({ contextExplainsIt: false, suggestPriority: true, confidence: "high" })] }), /confidence is "high"/);
});

test("4. the validated result is exactly the model output - nothing is rewritten, and the input is not mutated", () => {
  const raw = response({
    checklist: [{ checkpointSlug: "stance-setup", score: 3, notes: "Athletic base with visible knee flex." }],
    issues: [issue({ suggestPriority: true, confidence: "medium", suggestedDrill: "Tee work at the front hip" })],
  });
  const before = structuredClone(raw);
  const result = validate(raw);
  assert.deepEqual(raw, before, "the parsed model object is not mutated");
  assert.deepEqual(result.issues, raw.issues, "every issue field is returned exactly as produced");
  assert.deepEqual(result.checklist, raw.checklist);
  assert.equal(result.noActionReason, raw.noActionReason);
});

test("4. malformed values are rejected rather than coerced", () => {
  assert.throws(() => validate(response({ checklist: [{ checkpointSlug: "stance-setup", score: "3", notes: "Athletic base." }] })), /score must be the number 1, 2, or 3/);
  assert.throws(() => validate(response({ issues: [issue({ phase: "" })] })), /phase is invalid/);
  assert.throws(() => validate(response({ issues: [issue({ suggestedDrill: 5 })] })), /suggestedDrill must be a string/);
  assert.doesNotThrow(() => validate(response({ issues: [issue({ phase: null, suggestedDrill: null })] })), "absent optional fields stay allowed");
});

test("C: unknown pitch location cannot be invented in the cause or evidence", () => {
  rejects(response({ issues: [issue({ likelyCause: "Reaching for an outside pitch instead of adjusting with the legs." })] }), /likelyCause asserts pitch location/);
  rejects(response({ issues: [issue({ likelyCause: "Reaching for a poor pitch location." })] }), /pitch location is unknown/);
  rejects(response({ issues: [issue({ evidence: "She chased a ball out of the zone." })] }), /evidence asserts pitch location/);
  rejects(response({ checklist: [{ checkpointSlug: "contact-point", score: 1, notes: "Late on a changeup." }] }), /names pitch type "changeup" but the supplied pitch type is unknown/);
  assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "Her hands reach out toward the pitcher through contact." })] })), "reach toward the pitcher is not a pitch-location claim");
});

test("D: unknown outcome cannot be asserted, but a hedged general consequence can", () => {
  rejects(response({ issues: [issue({ effect: "Disconnects the lower body from the swing, leading to weak contact and a complete loss of balance." })] }), /effect asserts this swing's outcome \("weak contact"\)/);
  rejects(response({ issues: [issue({ evidence: "The ball was popped up to the infield." })] }), /recorded pitch \(outcome unknown/);
  rejects(response({ checklist: [{ checkpointSlug: "contact-point", score: 3, notes: "Got a hit on this swing." }] }), /recorded pitch \(outcome unknown/);
  assert.doesNotThrow(() => validate(response({ issues: [issue({ effect: "This can lead to weaker contact over time." })] })));
  assert.doesNotThrow(() => validate(response({ checklist: [{ checkpointSlug: "contact-point", score: 3, notes: "Solid contact point out in front of the plate." }] })), "'contact point' is a checkpoint, not an outcome");
});

test("D: a hedge only excuses the clause it starts, not a later unhedged assertion", () => {
  rejects(response({ issues: [issue({ effect: "It can happen to anyone, and it led to weak contact." })] }), /effect asserts this swing's outcome \("weak contact"\)/);
});

test("D: a known outcome supports only claims consistent with it", () => {
  const foul = input({ pitch: { ...UNKNOWN_PITCH, outcome: "foul" } });
  assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "She fouled it straight back." })] }), foul));
  rejects(response({ issues: [issue({ evidence: "She hit a home run." })] }), /asserts this swing's outcome \("home run"\) but the recorded pitch \(outcome foul/, foul);
  rejects(response({ issues: [issue({ evidence: "A swing and miss." })] }), /recorded pitch \(outcome foul/, foul);
  const inPlay = input({ pitch: { ...UNKNOWN_PITCH, outcome: "ball_in_play" } });
  assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "She put the ball in play." })] }), inPlay));
  rejects(response({ issues: [issue({ evidence: "She popped up to second." })] }), /"popped up"\) but the recorded pitch \(outcome ball_in_play/, inPlay);
});

test("D: a take and a called strike are distinct recorded facts", () => {
  const ballTaken = input({ pitch: { ...UNKNOWN_PITCH, outcome: "ball", swung: false } });
  assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "She took the pitch with a quiet load." })] }), ballTaken), "ball + no swing -> took the pitch");
  rejects(response({ issues: [issue({ evidence: "A called strike on the outer half." })] }), /\("called strike"\) but the recorded pitch \(outcome ball, swung false\) does not support it/, ballTaken);
  const ballInferred = input({ pitch: { ...UNKNOWN_PITCH, outcome: "ball" } });
  assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "She took the pitch." })] }), ballInferred), "a ball is always a take");
  const called = input({ pitch: { ...UNKNOWN_PITCH, outcome: "called_strike" } });
  assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "A called strike; she took the pitch." })] }), called));
  const genericTake = input({ pitch: { ...UNKNOWN_PITCH, outcome: "take" } });
  assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "She took the pitch." })] }), genericTake));
  rejects(response({ issues: [issue({ evidence: "It was a called strike." })] }), /\("called strike"\) but the recorded pitch \(outcome take/, genericTake);
  const swungAt = input({ pitch: { ...UNKNOWN_PITCH, outcome: "ball", swung: true } });
  rejects(response({ issues: [issue({ evidence: "She took the pitch." })] }), /\("took the pitch"\)/, swungAt);
  rejects(response({ issues: [issue({ evidence: "She took the pitch." })] }), /\("took the pitch"\) but the recorded pitch \(outcome unknown, swung unknown\)/);
});

test("B/C: only a structured pitch zone is known location - empty, placeholder and free-text locations are unknown", () => {
  const withLocation = (location: string | null, zone: number | null = null) => input({ pitch: { ...UNKNOWN_PITCH, location, zone } });
  const flags = response({ issues: [issue({ contextExplainsIt: true, emergencySwingSuspected: true, likelyCause: "Reaching for an outside pitch." })] });
  // "", whitespace, "unknown", and the exact free text the manual CLI's --pitchContext puts in pitch.location.
  for (const location of ["", "   ", "unknown", "Outside, low - Groundout to short", "No pitch/result details recorded for this at-bat."]) {
    assert.throws(() => validate(flags, withLocation(location)), (e: unknown) => {
      assert.ok(e instanceof SemanticValidationError, `location ${JSON.stringify(location)}`);
      for (const re of [/contextExplainsIt is true but pitch location is unknown/, /emergencySwingSuspected is true but pitch location is unknown/, /likelyCause asserts pitch location/]) {
        assert.ok(e.violations.some((v) => re.test(v)), `location ${JSON.stringify(location)} missing ${re}`);
      }
      return true;
    });
  }
  assert.throws(() => validate(flags, withLocation(null, 13)), SemanticValidationError, "an out-of-range zone is not a known location");
  assert.doesNotThrow(() => validate(flags, withLocation("low and away", 9)), "a recorded zone (1-9) is a known location");
  assert.doesNotThrow(() => validate(flags, withLocation(null, 9)));
});

test("zoneCell is the coach app's own 9-zone mapping (pitchZonePicker.js zoneLabel), not a competing one", async () => {
  const picker = pathToFileURL(path.join(process.cwd(), "coach", "components", "pitchZonePicker.js")).href;
  const { zoneLabel } = (await import(picker)) as { zoneLabel: (z: number) => string };
  for (let zone = 1; zone <= 9; zone++) {
    const { row, col } = zoneCell(zone);
    assert.equal(`${row[0]!.toUpperCase()}${row.slice(1)}, ${col[0]!.toUpperCase()}${col.slice(1)}`, zoneLabel(zone), `zone ${zone}`);
  }
});

test("C: a recorded zone is inside the strike zone, so 'out of the zone' claims contradict it", () => {
  const zone = (z: number) => input({ pitch: { ...UNKNOWN_PITCH, zone: z } });
  for (const z of [1, 5, 9]) {
    rejects(response({ issues: [issue({ evidence: "The pitch was outside the strike zone." })] }), new RegExp(`"outside the strike zone" but the recorded zone ${z} is inside the strike zone`), zone(z));
    rejects(response({ issues: [issue({ evidence: "She chased out of the zone." })] }), /"out of the zone" but the recorded zone \d is inside the strike zone/, zone(z));
    rejects(response({ issues: [issue({ likelyCause: "Reaching for a ball off the plate." })] }), /"off the plate"/, zone(z));
    // Neutral location wording is allowed.
    assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "She stayed through the middle of the zone and kept the barrel in the zone." })] }), zone(z)));
  }
});

test("C: directional wording is rejected only when it names the opposite side of the recorded cell", () => {
  const zone = (z: number) => input({ pitch: { ...UNKNOWN_PITCH, zone: z } });
  // Zone 3 = High, Out; zone 6 = Middle, Out; zone 5 = Middle, Mid.
  assert.doesNotThrow(() => validate(response({ issues: [issue({ likelyCause: "Reaching for the outside pitch." })] }), zone(3)), "outside pitch on an Out cell");
  assert.doesNotThrow(() => validate(response({ issues: [issue({ likelyCause: "Reaching for the outside pitch." })] }), zone(5)), "Mid cells contradict nothing");
  assert.doesNotThrow(() => validate(response({ issues: [issue({ likelyCause: "Adjusting to a high pitch." })] }), zone(3)));
  // Zone 7 = Low, In.
  rejects(response({ issues: [issue({ likelyCause: "Reaching for the outside pitch." })] }), /"outside pitch" but the recorded zone 7 is low, in/, zone(7));
  rejects(response({ issues: [issue({ likelyCause: "Adjusting to a high pitch." })] }), /"high pitch" but the recorded zone 7 is low, in/, zone(7));
  rejects(response({ issues: [issue({ evidence: "It was up and in." })] }), /"up and in" but the recorded zone 9 is low, out/, zone(9));
  assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "It was low and away." })] }), zone(9)));
});

test("C: an unknown zone keeps the unknown-location rules", () => {
  rejects(response({ issues: [issue({ likelyCause: "Reaching for the outside pitch." })] }), /asserts pitch location \("outside pitch"\) but pitch location is unknown/);
  rejects(response({ issues: [issue({ evidence: "The pitch was outside the strike zone." })] }), /but pitch location is unknown/);
});

test("E: unrelated images never switch the phase check off or add phase coverage", () => {
  assert.deepEqual([...suppliedPhases(["phase_stance.png", "phase_load.png", "phase_contact.png", "random.png"])!].sort(), ["contact", "load", "stance"]);
  const mixed = input({}, { frameNames: ["phase_stance.png", "phase_load.png", "phase_contact.png", "random.png"] });
  rejects(response({ checklist: [{ checkpointSlug: "follow-through", score: 2, notes: "Balanced finish." }] }), /follow_through were not supplied/, mixed);
  const manyStray = input({}, { frameNames: ["phase_contact.png", "follow_through.png", "IMG_0001.jpg", "frame_001.png"] });
  rejects(response({ checklist: [{ checkpointSlug: "follow-through", score: 2, notes: "Balanced finish." }] }), /follow_through were not supplied/, manyStray);
  assert.deepEqual([...suppliedPhases(["phase_contact.png", "follow_through.png", "IMG_0001.jpg"])!], ["contact"], "only phase_<slug> stills count");
  // Zero phase stills: whole-clip coverage, unchanged.
  assert.equal(suppliedPhases(["random1.png", "random2.jpg"]), null);
  assert.doesNotThrow(() => validate(response({ checklist: [{ checkpointSlug: "follow-through", score: 2, notes: "Balanced finish." }] }), input({}, { frameNames: ["random1.png", "random2.jpg"] })));
});

test("C/D: uncertainty statements are recognized in either word order; nearby affirmative claims still fail", () => {
  const sparse = (noActionReason: string) => ({ ...response({ issues: [], checklist: [] }), noActionNeeded: true, noActionReason });
  for (const reason of [
    "No pitch location was supplied.", "Pitch location was not supplied.",
    "No pitch location data.", "Pitch location data unavailable.", "Pitch location: unknown.",
    "No pitch location was provided.", "Pitch location was not provided.",
    "No pitch location was recorded.", "Pitch location was not recorded.", "Unknown pitch location.",
  ]) assert.doesNotThrow(() => validate(sparse(reason)), reason);
  rejects(sparse("No pitch location was supplied, but she chased it."), /asserts pitch location \("chased"\)/);
  rejects(response({ issues: [issue({ evidence: "She showed no chase on the outside pitch." })] }), /evidence asserts pitch location/);
  rejects(response({ issues: [issue({ evidence: "The pitch location was outside." })] }), /evidence asserts pitch location \("pitch location"\)/);
});

test("C: a known pitch type supports only that type (or its category)", () => {
  const fastball = input({ pitch: { ...UNKNOWN_PITCH, pitchType: "fastball" } });
  assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "On time for the fastball." })] }), fastball));
  rejects(response({ issues: [issue({ evidence: "Out in front of a changeup." })] }), /names pitch type "changeup" but the supplied pitch type is fastball/, fastball);
  const changeup = input({ pitch: { ...UNKNOWN_PITCH, pitchType: "change-up" } });
  assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "Early on the off-speed pitch." })] }), changeup));
});

test("C/D: every returned prose field is checked - observed fields strictly, prescriptive fields for claims about this swing", () => {
  rejects(response({ compNotes: ["Hard contact like a pro."] }), /compNotes\[0\]\.note asserts this swing's outcome/);
  rejects({ ...response({ issues: [], checklist: [] }), noActionNeeded: true, noActionReason: "Just a swing and miss." }, /response\.noActionReason asserts this swing's outcome/);
  rejects(response({ issues: [issue({ suggestedDrill: "Tee work to fix the weak contact." })] }), /suggestedDrill asserts this swing's outcome/);
  rejects(response({ issues: [issue({ lookForNext: "Whether she lays off the changeup." })] }), /lookForNext names pitch type/);
  rejects(response({ drills: [{ title: "Tee work", description: "Stop reaching for the outside pitch." }] }), /drills\[0\]\.description asserts pitch location/);
  // Generic practice language is not a claim about the observed pitch or result.
  assert.doesNotThrow(() => validate(response({ drills: [{ title: "Line drive tee drill", description: "Hit line drives off a tee set at the front hip." }] })));
  assert.doesNotThrow(() => validate(response({ drills: [{ title: "Chase drill", description: "Take pitches out of the zone during front toss." }] })));
  assert.doesNotThrow(() => validate(response({ comps: [{ compName: "Alo", cue: "Like Alo staying tall on an outside pitch." }] })));
});

test("C/D: stating that a fact is unknown is not a claim about it", () => {
  const sparse = { ...response({ issues: [], checklist: [] }), noActionNeeded: true, noActionReason: "Pitch location is unknown, so no pitch-related issue is claimed; the stills show no clear mechanical issue." };
  assert.doesNotThrow(() => validate(sparse));
  assert.doesNotThrow(() => validate({ ...sparse, noActionReason: "Pitch location data was unavailable, so no pitch-based judgment is made." }));
  assert.doesNotThrow(() => validate(response({ checklist: [{ checkpointSlug: "contact-point", score: 2, notes: "Outcome not recorded; contact point is slightly deep." }] })));
  rejects(response({ issues: [issue({ evidence: "Pitch location is unknown, but she chased it." })] }), /evidence asserts pitch location \("chased"\)/);
  // The exemption covers only the phrase declared unknown, not the rest of the clause.
  rejects(response({ issues: [issue({ evidence: "Pitch location is unknown because she chased the outside pitch." })] }), /evidence asserts pitch location \("(chased|outside pitch)"\)/);
  rejects(response({ issues: [issue({ evidence: "Outcome not recorded despite weak contact." })] }), /asserts this swing's outcome \("weak contact"\)/);
});

test("D: other result wording is caught when the outcome is unknown", () => {
  rejects(response({ issues: [issue({ evidence: "Foul to right field." })] }), /asserts this swing's outcome \("Foul"\)/);
  rejects(response({ issues: [issue({ evidence: "She singled up the middle." })] }), /asserts this swing's outcome \("singled"\)/);
  rejects(response({ issues: [issue({ evidence: "She hit a single to left." })] }), /asserts this swing's outcome \("hit a single"\)/);
  rejects(response({ issues: [issue({ evidence: "She walked." })] }), /asserts this swing's outcome \("walked"\)/);
  assert.doesNotThrow(() => validate(response({ issues: [issue({ evidence: "From a single swing and a single frame the front shoulder opens early; she walked through the finish." })] })), "policy language and movement are not results");
  assert.doesNotThrow(() => validate(response({ drills: [{ title: "Foul line tee work", description: "Aim along the foul line." }] })), "the foul line is a place, not a result");
});

test("the Gemini provider path rejects a semantically invalid response before returning it (so nothing is written)", async () => {
  const saved = process.env.GEMINI_MODEL;
  process.env.GEMINI_MODEL = "test-model";
  try {
    const client = { models: { generateContent: async () => ({ text: JSON.stringify(response({ summary: "The swing is visible.", strengths: [], issues: [issue({ confidence: "high" })] })) }) } } as unknown as Pick<GoogleGenAI, "models">;
    await assert.rejects(analyzeSwing([{ data: Buffer.from("png"), mimeType: "image/png" }], input(), { client }), SemanticValidationError);
  } finally {
    if (saved === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = saved;
  }
});

test("E: a checkpoint cannot be scored without its required still (follow-through on ab1_hit's stills)", () => {
  rejects(response({ checklist: [{ checkpointSlug: "follow-through", score: 1, notes: "Loses balance at the finish." }] }), /follow-through\) is scored but its required still\(s\) follow_through were not supplied/);
  rejects(response({ checklist: [{ checkpointSlug: "stride", score: 2, notes: "Short stride." }] }), /stride were not supplied/);
  rejects(response({ checklist: [{ checkpointSlug: "swing-decisions", score: 2, notes: "Swung at a borderline pitch." }] }), /swing-decisions\) is scored but pitch location is unknown/);
  rejects(response({ issues: [issue({ phase: "follow_through" })] }), /phase "follow_through" has no supplied still/);
  const withFinish = input({}, { frameNames: [...PHASE_STILLS, "phase_follow_through.png"] });
  assert.doesNotThrow(() => validate(response({ checklist: [{ checkpointSlug: "follow-through", score: 2, notes: "Finishes over a firm front side." }] }), withFinish));
});

test("9. the coach app's tier definition and the backend's cannot drift", async () => {
  const coach = pathToFileURL(path.join(process.cwd(), "coach", "components", "checkpointEvidence.js")).href;
  const { CHECKPOINT_EVIDENCE_TIERS: coachTiers } = (await import(coach)) as { CHECKPOINT_EVIDENCE_TIERS: unknown };
  assert.deepEqual(coachTiers, CHECKPOINT_EVIDENCE_TIERS);
  // The product's tiers, exactly.
  const byTier = (t: string) => Object.entries(CHECKPOINT_EVIDENCE_TIERS).filter(([, e]) => e.tier === t).map(([s]) => s).sort();
  assert.deepEqual(byTier("single-angle"), ["extension", "hip-shoulder-sep"]);
  assert.deepEqual(byTier("single-instant"), ["contact-point", "follow-through", "load", "stance-setup", "stride"]);
  assert.deepEqual(byTier("whole-swing"), ["bat-path", "hand-path", "head-eyes", "swing-decisions"]);
});

test("9. compModal.js keeps no tier list of its own - it derives both maps from checkpointEvidence.js", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(path.join(process.cwd(), "coach", "components", "compModal.js"), "utf8");
  assert.match(src, /import \{ CHECKPOINT_EVIDENCE_TIERS \} from "\.\/checkpointEvidence\.js"/);
  assert.doesNotMatch(src, /new Set\(\["extension"/, "no hand-written single-angle list");
  assert.doesNotMatch(src, /"contact-point": "contact"/, "no hand-written phase map");
});

test("1-4. phase stills only: a whole-swing checkpoint score is rejected, however many stills there are", () => {
  const allPhases = input({}, { frameNames: ["phase_stance.png", "phase_load.png", "phase_stride.png", "phase_contact.png", "phase_extension.png", "phase_follow_through.png"] });
  for (const slug of ["hand-path", "bat-path", "head-eyes", "swing-decisions"]) {
    rejects(response({ checklist: [{ checkpointSlug: slug, score: 2, notes: "Looks fine." }] }), new RegExp(`${slug}\\) is a whole-swing checkpoint but only phase stills were supplied`), allPhases);
  }
  // A phase still mixed with other images is still phase-stills-only evidence.
  rejects(response({ checklist: [{ checkpointSlug: "hand-path", score: 3, notes: "Direct path." }] }), /whole-swing checkpoint/, input({}, { frameNames: ["phase_contact.png", "random.png"] }));
});

test("5. dense/full-sequence evidence keeps allowing whole-swing checkpoints", () => {
  const dense = input({ pitch: { ...UNKNOWN_PITCH, zone: 5 } }, { frameNames: ["frame_001.png", "frame_002.png", "frame_003.png"] });
  for (const slug of ["hand-path", "bat-path", "head-eyes", "swing-decisions"]) {
    assert.doesNotThrow(() => validate(response({ checklist: [{ checkpointSlug: slug, score: 2, notes: "Consistent through the swing." }] }), dense), slug);
  }
  rejects(response({ checklist: [{ checkpointSlug: "swing-decisions", score: 2, notes: "Consistent." }] }), /pitch location is unknown/, input({}, { frameNames: ["frame_001.png"] }));
});

test("5b. a batter-zoomed swing sequence alongside phase stills counts as whole-swing evidence", () => {
  const seq = (n: number) => Array.from({ length: n }, (_, i) => `swing_seq_${String(i + 1).padStart(2, "0")}.png`);
  const withSeq = input({}, { frameNames: [...PHASE_STILLS, "zoom_contact.png", ...seq(MIN_SWING_SEQUENCE_FRAMES)] });
  assert.equal(wholeSwingSupplied(withSeq.swing.frameNames), true);
  for (const slug of ["hand-path", "bat-path", "head-eyes"]) {
    assert.doesNotThrow(() => validate(response({ checklist: [{ checkpointSlug: slug, score: 2, notes: "Consistent through the swing." }] }), withSeq), slug);
  }
  // Still needs a known pitch location for swing decisions.
  rejects(response({ checklist: [{ checkpointSlug: "swing-decisions", score: 2, notes: "Consistent." }] }), /pitch location is unknown/, withSeq);
  // A short sequence, or zoom crops alone, is not whole-swing evidence.
  const shortSeq = input({}, { frameNames: [...PHASE_STILLS, ...seq(MIN_SWING_SEQUENCE_FRAMES - 1)] });
  assert.equal(wholeSwingSupplied(shortSeq.swing.frameNames), false);
  rejects(response({ checklist: [{ checkpointSlug: "hand-path", score: 2, notes: "Direct." }] }), /whole-swing checkpoint but only phase stills were supplied/, shortSeq);
  assert.equal(wholeSwingSupplied([...PHASE_STILLS, "zoom_contact.png", "zoom_load.png"]), false);
  // Zoom crops add no phase coverage of their own.
  assert.deepEqual([...suppliedPhases(["phase_load.png", "zoom_contact.png"])!], ["load"]);
});

test("6-7. hip-shoulder separation is never AI-scored; leaving it unscored is fine", () => {
  for (const frameNames of [PHASE_STILLS, ["frame_001.png", "frame_002.png"], []]) {
    for (const score of [1, 2, 3]) {
      rejects(response({ checklist: [{ checkpointSlug: "hip-shoulder-sep", score, notes: "Some separation." }] }), /hip-shoulder-sep\) is scored but is never AI-scored: the pipeline measures it but has no validated angle-to-score rubric/, input({}, { frameNames }));
    }
  }
  assert.doesNotThrow(() => validate(response({ checklist: [{ checkpointSlug: "stance-setup", score: 3, notes: "Athletic base." }] })), "unscored is allowed");
  assert.doesNotMatch(renderSwingAnalysisPrompt(input()), /Checkpoints \(score/);
});

test("8. a single-instant checkpoint with its phase still is allowed when otherwise valid", () => {
  for (const [slug, frame] of [["stance-setup", "phase_stance.png"], ["load", "phase_load.png"], ["contact-point", "phase_contact.png"], ["follow-through", "phase_follow_through.png"], ["stride", "phase_stride.png"]] as const) {
    assert.doesNotThrow(() => validate(response({ issues: [], checklist: [{ checkpointSlug: slug, score: 2, notes: "Visible in the still." }] }), input({}, { frameNames: [frame] })), slug);
  }
  assert.doesNotThrow(() => validate(response({ checklist: [{ checkpointSlug: "extension", score: 2, notes: "Arms extending after contact." }] })), "single-angle extension with its still");
});

test("E: dense frame sequences are not phase-restricted; every checkpoint has a requirement", () => {
  assert.equal(suppliedPhases(["frame_001.png", "frame_002.png"]), null);
  assert.equal(suppliedPhases([]), null);
  assert.deepEqual([...suppliedPhases(["phase_follow-through.png", "phase_contact.jpg"])!].sort(), ["contact", "follow_through"]);
  const dense = input({}, { frameNames: ["frame_001.png", "frame_002.png"] });
  assert.doesNotThrow(() => validate(response({ checklist: [{ checkpointSlug: "follow-through", score: 2, notes: "Balanced finish." }] }), dense));
  assert.deepEqual(Object.keys(CHECKPOINT_EVIDENCE_TIERS).sort(), CHECKPOINTS.map((c) => c.slug).sort());
  for (const c of CHECKPOINTS) assert.ok(checkpointEvidence(c.slug), c.slug);
});

const item = (claimId: string, doesNotApplyWhen: string): MethodologyItem => ({
  claimId, candidateId: null, reviewMethod: "human", humanVerified: true, concept: "posture", approvedText: "text", observableEvidence: "visible",
  coachingCue: null, appliesWhen: "tee drill work", doesNotApplyWhen, sportScope: "both", levelScope: ["youth"], ageGuardrail: "youth_appropriate",
  evidenceType: "drill_prescription", numericClaim: false, numericEvidenceRef: null, sourceName: "s", sourceUrl: "https://example.test",
  materialTitle: "m", materialUrl: "https://example.test/m", materialExternalId: null, materialPublishedAt: null, sourceStartSeconds: null,
  sourceEndSeconds: null, sourceLocation: null, reviewedBy: null, reviewedAt: null,
});

test("F: a claim whose own exclusion names game situations is withheld from game swings and cannot be cited", () => {
  const items = [item("claim-game-excluded", "Full game situations where timing varies unpredictably."), item("claim-ok", "Physical therapy screenings.")];
  const game = filterApplicableMethodology(items, { sport: "softball", ageBand: null, swingContext: "game" }).map((c) => c.claimId);
  assert.deepEqual(game, ["claim-ok"]);
  assert.deepEqual(filterApplicableMethodology(items, { sport: "softball", ageBand: null }).map((c) => c.claimId), ["claim-ok"], "unknown context fails closed");
  assert.deepEqual(filterApplicableMethodology(items, { sport: "softball", ageBand: null, swingContext: "practice" }).map((c) => c.claimId), ["claim-game-excluded", "claim-ok"]);
  assert.equal(methodologyExcludedForContext("Practicing live-pitching hitting without controlled tee setups.", "game"), true);
  assert.equal(methodologyExcludedForContext("Executing check swings, bunts, or emergency contact swings.", "game"), false);
  assert.throws(() => validate(response({ issues: [issue({ knowledgeClaimIds: ["claim-game-excluded"] })] }), input({ knowledgeClaimIds: game })), /cites a knowledge claim not included in this run/);
  // ABCA-YT-001's published exclusion: live pitching (which a game is) without a tee.
  assert.equal(methodologyExcludedForContext("Practicing dynamic pitch recognition or live-pitching hitting without controlled tee setups.", "game"), true);
});

test("F: a claim whose own exclusion covers emergency swings cannot back a swing flagged as one", () => {
  const known = input({
    pitch: { ...UNKNOWN_PITCH, location: "up and in", zone: 1 },
    knowledgeClaimIds: ["claim-sequencing"],
    knowledgeClaimExclusions: { "claim-sequencing": "Executing check swings, bunts, or emergency contact swings or adjustments." },
  });
  const flagged = issue({ emergencySwingSuspected: true, contextExplainsIt: true, knowledgeClaimIds: ["claim-sequencing"] });
  rejects(response({ issues: [flagged] }), /cites claim-sequencing, whose own exclusion covers emergency\/protective swings/, known);
  assert.doesNotThrow(() => validate(response({ issues: [{ ...flagged, emergencySwingSuspected: false }] }), known), "the same claim is fine on a full swing");
});

test("the rejected ab1_hit draft pattern fails with every violation listed", () => {
  const draft = response({
    checklist: [
      { checkpointSlug: "stance-setup", score: 3, notes: "Solid and balanced starting posture." },
      { checkpointSlug: "load", score: 3, notes: "Adequate initial weight shift." },
      { checkpointSlug: "contact-point", score: 1, notes: "Severe break in posture; chest dives significantly over the plate." },
      { checkpointSlug: "follow-through", score: 1, notes: "Complete loss of balance due to extreme forward lean." },
    ],
    issues: [issue({
      issue: "Diving the chest forward and losing posture at contact.", concept: "posture", confidence: "high",
      likelyCause: "Reaching for a poor pitch location instead of adjusting with the legs and maintaining torso rotation.",
      effect: "Disconnects the lower body from the swing, leading to weak contact and a complete loss of balance.",
      contextExplainsIt: true, emergencySwingSuspected: true,
    })],
  });
  assert.throws(() => validate(draft), (e: unknown) => {
    assert.ok(e instanceof SemanticValidationError);
    for (const re of [/confidence is "high"/, /contextExplainsIt/, /emergencySwingSuspected/, /likelyCause asserts pitch location/, /effect asserts this swing's outcome/, /follow-through\) is scored/]) {
      assert.ok(e.violations.some((v) => re.test(v)), `missing violation ${re}`);
    }
    return true;
  });
});

test("simplified prompt states evidence rules and omits checklist scoring", () => {
  const prompt = renderSwingAnalysisPrompt(input());
  assert.match(prompt, /is never high/);
  assert.match(prompt, /Unknown pitch stays unknown/);
  assert.match(prompt, /Unknown outcome stays unknown/);
  assert.match(prompt, /Write for a parent/);
  assert.match(prompt, /does not apply when/);
  assert.doesNotMatch(prompt, /Checkpoints \(score/);
  assert.match(prompt, /visible strengths/);
  assert.match(prompt, /"swing_context": "game"/);
  assert.match(SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS, /"confidence": "medium"\|"low"/);
});
