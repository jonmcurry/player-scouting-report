#!/usr/bin/env node
/**
 * ONE-OFF RESEARCH SCRIPT - not part of the production pipeline, not wired
 * into any npm script other than being run directly with tsx. Sends each of
 * the 10 locked seed-video YouTube URLs to Gemini (which can ingest a public
 * YouTube URL directly via Part.fileData.fileUri) and asks it to actually
 * watch/listen and extract candidate methodology claims per the review
 * discipline in docs/research/ - this repo's own tooling has no other way
 * to watch video content.
 *
 * Output is RAW, UNREVIEWED MODEL OUTPUT written to
 * scripts/research/raw-output/<videoId>.json. Nothing here is a database
 * write, nothing sets human_verified=true or active=true (those fields
 * don't even exist in this script's output - see methodology_claims'
 * schema), and nothing is published. A human (or the calling Claude session)
 * still has to read, cross-check and curate this into the final
 * docs/research/*.md artifacts.
 *
 * Requires a real GEMINI_API_KEY in .env.
 */
import { GoogleGenAI, Type } from "@google/genai";
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "raw-output");
fs.mkdirSync(outDir, { recursive: true });

const VIDEOS = [
  { n: 1, id: "tXKjS3iKgAk", label: "Driveline - How To Coach Hitting Mechanics Pt. 1" },
  { n: 2, id: "tTBSOTw7XoQ", label: "Driveline - 3 Drills to Improve Timing and Load When Hitting" },
  { n: 3, id: "22bq90ojT_o", label: "Megan Rembielak / Tanner Tees - Two Tee Extension Drill" },
  { n: 4, id: "NThwdXRo0b8", label: "Blast Motion - Youth Hitting Drills - Swing Plane" },
  { n: 5, id: "tfz7sCIcu8g", label: "Antonelli Softball - Behind the Scenes Softball Lesson" },
  { n: 6, id: "RtQUfmkqX0s", label: "JT Gasso (FloCollege Softball) - 3-Plate Drill" },
  { n: 7, id: "IwEsqGwUZDQ", label: "Mike Candrea / Championship Productions - Ultimate Coaching Clinic" },
  { n: 8, id: "7J-JoyaSabA", label: "ABCA - Youth Practice Plan Series | Hitting Tips" },
  { n: 9, id: "8tT4KXt5hhk", label: "ABCA / Bryson LeBlanc - Swinging vs. Hitting" },
  { n: 10, id: "fETlemtrceo", label: "Let's Have This Conversation - The Science Behind Hitting in Baseball with Chad Miller" },
];

const CONCEPTS = [
  "stance_setup", "load", "stride_plant", "hip_shoulder_sequencing", "hand_path", "barrel_path",
  "contact", "extension", "head_visual_stability", "finish_balance", "swing_decision", "timing",
  "front_side_stability", "posture", "barrel_depth", "pitch_location_adjustment", "game_approach",
];

const PROMPT = `You are doing RESEARCH EXTRACTION ONLY for a coaching knowledge base. You are not
approving anything and nothing you output becomes active production guidance - a human
reviews every claim afterward.

Watch/listen to this YouTube video directly (you have been given its URL as video input -
actually use the video/audio content, not just the title). Then extract candidate hitting-
methodology claims following ALL of these rules:

1. VERIFY METADATA: report the exact title, channel, and your best estimate of video
   duration from what you can observe. If you cannot determine something, say "unknown" -
   never invent it.

2. CLAIM ATOMICITY: one claim = one coaching proposition. Do not combine several ideas into
   one claim. Prefer 1-3 strong, atomic claims. Fewer is fine. Do not force weak claims.

3. TIMESTAMPS: every claim needs a real start (and end, if a range) timestamp in seconds,
   taken from where you actually heard/saw it in the video. If you are not confident in the
   exact timestamp, still give your best estimate AND set timestamp_confidence to "low" or
   "estimated" - never claim "high" confidence you don't have. Do not fabricate a timestamp
   with false confidence.

4. PARAPHRASE: use a concise HitterLoop-authored paraphrase (claim_text). Also record a
   short paraphrase of the original source proposition (source_proposition) - not a long
   quotation.

5. CAUSE VS SYMPTOM: if the source uses shorthand like "pulling the head," "flying open,"
   "staying back," etc, note in cause_vs_symptom_note whether this is an observed pattern, the
   source's causal interpretation, a coaching cue, or ambiguous - do not silently encode a
   symptom as a proven cause.

6. OBSERVABLE EVIDENCE: state what an ordinary coach/game video (no lab sensors, no
   validated 3D reconstruction, no bat sensor data) could actually observe that would make
   this claim relevant. If the claim depends on proprietary sensor data (e.g. Blast Motion
   metrics) that ordinary video can't reproduce, say so explicitly in quality_notes and mark
   approval_readiness conservatively.

7. EVIDENCE TYPE: use one of coaching_instruction, coaching_heuristic, drill_prescription,
   empirical_training_observation, biomechanical_explanation, research_supported,
   expert_opinion. Only use research_supported if the video itself presents or clearly cites
   actual research - a podcast/interview format or a title containing "science" is NOT by
   itself research_supported.

8. NUMERIC CLAIMS: default numeric_claim=false. Only set true for an actual numeric
   normative claim (an ideal angle, an exact time window, a specific speed/threshold), and
   if so, describe what evidence (if any) was given for that number.

9. SPORT SCOPE: baseball, softball, or both - be conservative, only "both" if the
   proposition genuinely generalizes across the two sports as actually presented.

10. AGE GUARDRAIL: one of youth_appropriate, teen_appropriate, advanced_only,
    requires_physical_screening - be conservative; do not mark elite/advanced content
    youth_appropriate.

11. CONCEPT: map to the closest of this controlled vocabulary: ${CONCEPTS.join(", ")}.
    If nothing fits well, use the closest one and explain the mismatch in quality_notes.

12. DRILLS: if the video demonstrates a drill, record it separately (drills[]) with name,
    timestamp, the problem/behavior it targets, equipment needed, and whether the source ties
    it to a specific fault.

13. OUT OF SCOPE: do not produce injury prediction, medical screening, physical diagnosis,
    or maturation-timeline claims - flag such content in quality_notes instead of turning it
    into a claim.

14. If the video's actual content is mostly philosophy/practice-design/approach rather than
    observable swing mechanics, say so in content_character and still extract only what
    genuinely fits - do not force mechanical claims out of philosophical content.

15. Every claim you output is automatically review_status=candidate,
    human_verified=false, active=false - you have no ability to change that.

Return your best-effort structured extraction now.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verifiedTitle: { type: Type.STRING },
    verifiedChannel: { type: Type.STRING },
    estimatedDurationSeconds: { type: Type.INTEGER, nullable: true },
    contentCharacter: { type: Type.STRING, description: "e.g. 'mechanics instruction', 'drill demonstration', 'philosophy/approach', 'interview/podcast commentary'" },
    overallNotes: { type: Type.STRING },
    claims: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          concept: { type: Type.STRING, enum: CONCEPTS },
          conceptMismatchNote: { type: Type.STRING, nullable: true },
          claimText: { type: Type.STRING },
          sourceProposition: { type: Type.STRING },
          observableEvidence: { type: Type.STRING },
          sportScope: { type: Type.STRING, enum: ["baseball", "softball", "both"] },
          ageGuardrail: { type: Type.STRING, enum: ["youth_appropriate", "teen_appropriate", "advanced_only", "requires_physical_screening"] },
          levelScopeNote: { type: Type.STRING },
          appliesWhen: { type: Type.STRING },
          doesNotApplyWhen: { type: Type.STRING },
          coachingCue: { type: Type.STRING, nullable: true },
          evidenceType: { type: Type.STRING, enum: ["coaching_instruction", "coaching_heuristic", "drill_prescription", "empirical_training_observation", "biomechanical_explanation", "research_supported", "expert_opinion"] },
          numericClaim: { type: Type.BOOLEAN },
          numericEvidenceRef: { type: Type.STRING, nullable: true },
          startSeconds: { type: Type.NUMBER },
          endSeconds: { type: Type.NUMBER, nullable: true },
          timestampConfidence: { type: Type.STRING, enum: ["high", "medium", "low", "estimated"] },
          causeVsSymptomNote: { type: Type.STRING, nullable: true },
          qualityNotes: { type: Type.STRING },
          approvalReadiness: { type: Type.STRING, enum: ["strong_candidate", "weak_candidate", "likely_reject", "needs_human_judgment"] },
        },
        required: ["concept", "claimText", "sourceProposition", "observableEvidence", "sportScope", "ageGuardrail", "appliesWhen", "doesNotApplyWhen", "evidenceType", "numericClaim", "startSeconds", "timestampConfidence", "qualityNotes", "approvalReadiness"],
      },
    },
    drills: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          startSeconds: { type: Type.NUMBER, nullable: true },
          timestampConfidence: { type: Type.STRING, enum: ["high", "medium", "low", "estimated", "unknown"] },
          targetedProblem: { type: Type.STRING },
          equipment: { type: Type.STRING },
          tiedToSpecificFault: { type: Type.BOOLEAN },
          sportScope: { type: Type.STRING, enum: ["baseball", "softball", "both"] },
          ageLevelCaution: { type: Type.STRING },
        },
        required: ["name", "targetedProblem", "sportScope"],
      },
    },
    weakOrRejectedNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["verifiedTitle", "verifiedChannel", "contentCharacter", "overallNotes", "claims", "drills", "weakOrRejectedNotes"],
};

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY must be set in .env");
  // Deliberately independent of the production GEMINI_MODEL env var (used by
  // src/services/ai/geminiAnalyzer.ts) - this is a one-off research script,
  // not a change to production model configuration. gemini-2.5-flash
  // returned 404 "no longer available to new users" pointing at this model.
  const model = process.env.GEMINI_RESEARCH_MODEL?.trim() || "gemini-3.6-flash";
  const ai = new GoogleGenAI({ apiKey });

  const onlyIds = process.argv.slice(2);
  const targets = onlyIds.length ? VIDEOS.filter((v) => onlyIds.includes(v.id)) : VIDEOS;

  for (const v of targets) {
    const url = `https://www.youtube.com/watch?v=${v.id}`;
    process.stdout.write(`[${v.n}/10] ${v.label} (${url}) ... `);
    try {
      let response;
      let attempt = 0;
      for (;;) {
        attempt++;
        try {
          response = await ai.models.generateContent({
            model,
            contents: [
              { fileData: { fileUri: url } },
              { text: PROMPT },
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA,
            },
          });
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (attempt >= 5 || !message.includes("UNAVAILABLE")) throw err;
          const delayMs = attempt * 15000;
          process.stdout.write(`(503, retry ${attempt}/5 in ${delayMs / 1000}s) `);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      const text = response.text;
      if (!text) throw new Error("empty response");
      const parsed = JSON.parse(text);
      const outPath = path.join(outDir, `${v.n}-${v.id}.json`);
      fs.writeFileSync(outPath, JSON.stringify({ video: v, url, modelVersion: (response as unknown as { modelVersion?: string }).modelVersion ?? null, extraction: parsed }, null, 2));
      console.log(`OK -> ${path.relative(process.cwd(), outPath)} (${parsed.claims?.length ?? 0} claims, ${parsed.drills?.length ?? 0} drills)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`BLOCKED: ${message}`);
      const outPath = path.join(outDir, `${v.n}-${v.id}.blocked.json`);
      fs.writeFileSync(outPath, JSON.stringify({ video: v, url, blocked: true, reason: message }, null, 2));
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
