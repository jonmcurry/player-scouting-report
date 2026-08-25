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
export interface IssueDraft {
  issue: string;
  seenInAtBats: string;
  likelyCause: string;
  effect: string;
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
  "issues": [{ "issue": string, "seenInAtBats": string, "likelyCause": string, "effect": string }],
  "comps": [{ "compName": string (one of: ${SOFTBALL_COMP_BANK.join(", ")}), "cue": string }],
  "compNotes": [string],
  "drills": [{ "title": string, "description": string }]
}

Any of the five arrays may be empty - never pad an array with a low-confidence entry just to
avoid returning empty.`;
