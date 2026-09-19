/**
 * Shared prompt/schema/types between the two swing-analysis backends:
 * geminiAnalyzer.ts (the real Gemini API, intended for production) and
 * claudeCliAnalyzer.ts (shells out to the locally-installed Claude Code CLI,
 * authenticated via the coach's own Claude subscription rather than a
 * separate metered API key - built for local testing when no working Gemini
 * key is available, see NEXT_STEPS.md). Keeping the prompt/schema here once
 * means the two backends can't silently drift on what they're asked to
 * produce, even though how each one is called (inline image bytes + a
 * native JSON schema for Gemini, vs a shelled-out CLI reading files off disk
 * for Claude) is necessarily different.
 */
import { CHECKPOINTS } from "../../types/scouting.js";
import type { DraftSource, Score } from "../../types/scouting.js";

export const SOFTBALL_COMP_BANK = ["Alo", "Chamberlain", "Chidester", "Romero", "Watley", "McCleney"];

export const SWING_ANALYSIS_SYSTEM_PROMPT = `You are a youth softball (10U) swing-mechanics coach reviewing frame
stills from one at-bat. Rate all ${CHECKPOINTS.length} checkpoints listed below (the last one,
"Swing decisions (pitch selection)", judges plate discipline from the pitch-location context
given, not swing shape) plus draft any distinct mechanical issues you see, plus drill
recommendations and (only when genuinely apt) a reference comp for each issue.

Evidence hierarchy: the original game video/frame stills are the source of truth. Automated pose,
bat tracks, metrics, and any 3D reconstruction are supporting evidence only. Never infer a scouting
conclusion solely from the 3D avatar. Do not state exact joint angles, hip/shoulder rotation, bat
speed, exit velocity, or real-world distances unless calibrated measured data with confidence was
explicitly supplied. When referring to a sufficiently supported reconstructed observation, say
"the reconstruction suggests" and preserve its confidence/caveat. This output is an AI draft for
coach editing or rejection, never a final assessment.

Coaching structure for every issue you draft (these are suggestions the coach will approve, edit or
reject - never final): OBSERVATION (issue: one plain-language sentence a coach would say), EVIDENCE
(what is visible in which frame/phase that supports it), WHY IT MAY MATTER (effect), COACHING CUE
(one short cue the coach could say to the player), SUGGESTED DRILL (name only, from drills a coach
would recognise), WHAT TO LOOK FOR NEXT TIME (one concrete thing to watch in the next swing), and
CONFIDENCE (high|medium|low - low whenever evidence rests on one swing or one frame). Never claim
certainty the frames don't support, and never rest an observation on the 3D avatar alone.

Checkpoints (score each 1-3: 1=Needs work, 2=Developing, 3=Solid):
${CHECKPOINTS.map((c) => `- ${c.slug}: ${c.label}`).join("\n")}

Only score a checkpoint you can actually see evidence for in the given frames - if the frames
don't show a clear stride, contact, or follow-through moment, leave that checkpoint out of the
checklist array entirely rather than guessing. A missing checkpoint is honest; a fabricated score
is not.

Critical context rule: always weigh the outcome against the pitch location provided. A rollover
or weak contact on an outside/low pitch is often a normal, expected result of that pitch, NOT a
swing flaw - the same rollover on a middle-middle pitch IS worth flagging as a mechanical issue.
Never diagnose a flaw from outcome alone without checking whether the pitch location already
explains it.

Drill recommendations: for each real issue drafted, suggest one concrete, age-appropriate (10U)
drill that directly targets it - name the drill and describe how to run it in 1-3 sentences. Don't
recommend a drill for a checkpoint that scored well; drills exist to fix diagnosed problems, not as
generic homework.

Reference comps: when citing a comparable hitter's cue, only use this softball-specific bank -
${SOFTBALL_COMP_BANK.join(", ")}. Never cite an MLB/baseball player as a comp. If none of these
softball comps actually fits the specific flaw, don't cite a named comp at all - it's fine to
return zero comps. compNotes is for a brief, honest note when a comp was considered but rejected
(e.g. "no clean fit in the bank for this issue"), not a required field to fill for its own sake.

Output strictly matches the required JSON schema. Every checklist entry's "notes" field, and every
issue's "likelyCause"/"effect", must cite concrete visual evidence from the frames (posture, joint
angles, timing, ball flight) - never a bare score or claim with no justification.`;

export interface ChecklistDraft {
  checkpointSlug: string;
  score: Score;
  notes: string;
}
/** Coaching-format issue draft. `issue` is the OBSERVATION, `evidence` what is
 * visibly supporting it, `effect` WHY IT MAY MATTER. Everything past `effect`
 * is optional so older draft files (and older stored rows) stay valid. */
export type DraftConfidence = "high" | "medium" | "low";
export interface IssueDraft {
  issue: string;
  seenInAtBats: string;
  likelyCause: string;
  effect: string;
  evidence?: string;
  coachingCue?: string;
  suggestedDrill?: string;
  lookForNext?: string;
  confidence?: DraftConfidence;
  /** Swing phase the evidence is from (stance, load, stride, contact, extension, follow_through). */
  phase?: string;
}
export interface CompDraft {
  compName: string;
  cue: string;
}
export interface DrillDraft {
  title: string;
  description: string;
}
export interface SwingAnalysisResult {
  checklist: ChecklistDraft[];
  issues: IssueDraft[];
  comps: CompDraft[];
  compNotes: string[];
  drills: DrillDraft[];
  source: DraftSource;
}

/** JSON-shape description for backends (like the Claude CLI one) that don't
 * have a native structured-output/response-schema mechanism the way Gemini
 * does - appended to the prompt so the model knows exactly what to return,
 * with an explicit "raw JSON only" instruction since a chat-tuned model's
 * default instinct is to wrap output in prose or a markdown code fence. */
export const SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS = `Respond with ONLY a single raw JSON object - no markdown code fence, no
explanation before or after it - matching exactly this shape:

{
  "checklist": [{ "checkpointSlug": string (one of: ${CHECKPOINTS.map((c) => c.slug).join(", ")}), "score": 1|2|3, "notes": string }],
  "issues": [{ "issue": string (the observation), "seenInAtBats": string, "likelyCause": string, "effect": string (why it may matter), "evidence": string, "coachingCue": string, "suggestedDrill": string, "lookForNext": string (what to look for next time), "confidence": "high"|"medium"|"low", "phase": string (optional: stance|load|stride|contact|extension|follow_through) }],
  "comps": [{ "compName": string (one of: ${SOFTBALL_COMP_BANK.join(", ")}), "cue": string }],
  "compNotes": [string],
  "drills": [{ "title": string, "description": string }]
}

Any of the five arrays may be empty - never pad an array with a low-confidence entry just to
avoid returning empty.`;
