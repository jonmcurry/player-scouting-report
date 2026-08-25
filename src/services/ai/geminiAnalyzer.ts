/**
 * Gemini-based swing analysis: given a batter's extracted frame stills plus
 * pitch-location context, asks Gemini to draft checklist scores + issues in
 * the same shape a coach would fill in by hand.
 *
 * IMPORTANT - verification status: unlike every other file in src/, this one
 * has NOT been exercised against a real API call. The Gemini API key shared
 * earlier in this session was compromised (pasted in plaintext chat) and had
 * to be rotated before any real use; a fresh key wasn't available while this
 * was built. What IS verified: the request/response shape below (model
 * constructor, `contents` Part[] structure for mixing text + inline image
 * data, `config.responseMimeType`/`responseSchema` for structured JSON output)
 * was checked directly against @google/genai's own installed TypeScript
 * definitions (node_modules/@google/genai/dist/genai.d.ts), not guessed or
 * copied from possibly-stale documentation. Run this against a real key
 * before trusting its output in production.
 *
 * Model choice: the spec asked for "Gemini 1.5 Flash" by name - used exactly
 * as specified below (GEMINI_MODEL). The SDK's own current quickstart
 * examples default to gemini-2.5-flash instead, which may mean 1.5 is
 * deprecated by the time this actually runs; swapping GEMINI_MODEL is a
 * one-line change if the API rejects the 1.5 model string.
 *
 * Auth: simple API-key auth against the Gemini Developer API (matches the
 * credential type actually provided - an AI-Studio-style key, not a GCP
 * service account) - NOT Vertex AI IAM/ADC auth. See this project's README
 * for the documented future-upgrade path to Vertex mode.
 *
 * Intended as the production analyzer (see processUploadQueue.ts's
 * AI_ANALYZER env var) - claudeCliAnalyzer.ts is the local-testing
 * alternative for when no working Gemini key is available, sharing this
 * file's prompt/schema/types via swingAnalysisShared.ts so the two backends
 * can't silently drift on what they're asked to produce.
 */
import { GoogleGenAI, Type } from "@google/genai";
import "dotenv/config";
import { CHECKPOINTS } from "../../types/scouting.js";
import {
  SOFTBALL_COMP_BANK,
  SWING_ANALYSIS_SYSTEM_PROMPT as SYSTEM_PROMPT,
  type ChecklistDraft,
  type IssueDraft,
  type CompDraft,
  type DrillDraft,
  type SwingAnalysisResult,
} from "./swingAnalysisShared.js";

const GEMINI_MODEL = "gemini-1.5-flash";

// Re-exported under their original "Gemini*"-prefixed names for every
// existing importer (analyze.ts etc.) - the underlying types now live in
// swingAnalysisShared.ts so claudeCliAnalyzer.ts can share them without
// duplicating (and risking drifting from) this file's own copy.
export type GeminiChecklistDraft = ChecklistDraft;
export type GeminiIssueDraft = IssueDraft;
export type GeminiCompDraft = CompDraft;
export type GeminiDrillDraft = DrillDraft;
export type GeminiAnalysisResult = SwingAnalysisResult;

export interface FrameImage {
  data: Buffer;
  mimeType: string; // e.g. "image/png"
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    checklist: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          checkpointSlug: {
            type: Type.STRING,
            enum: CHECKPOINTS.map((c) => c.slug),
          },
          score: { type: Type.INTEGER, minimum: 1, maximum: 3 },
          notes: { type: Type.STRING },
        },
        required: ["checkpointSlug", "score", "notes"],
      },
    },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          issue: { type: Type.STRING },
          seenInAtBats: { type: Type.STRING },
          likelyCause: { type: Type.STRING },
          effect: { type: Type.STRING },
        },
        required: ["issue", "seenInAtBats", "likelyCause", "effect"],
      },
    },
    comps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          compName: { type: Type.STRING, enum: SOFTBALL_COMP_BANK },
          cue: { type: Type.STRING },
        },
        required: ["compName", "cue"],
      },
    },
    compNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
    drills: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
        },
        required: ["title", "description"],
      },
    },
  },
  required: ["checklist", "issues", "comps", "compNotes", "drills"],
};

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY must be set (see .env.example) - get one at https://aistudio.google.com/apikey");
  }
  client = new GoogleGenAI({ apiKey });
  return client;
}

/**
 * pitchContext: free-text description of the pitch location(s)/outcome for
 * the at-bat(s) these frames come from (matches GameLogEntry.pitch/result
 * shape) - fed directly into the prompt so Gemini can apply the outside-
 * pitch-rollover-is-normal rule above.
 */
export async function analyzeSwing(
  frames: FrameImage[],
  pitchContext: string,
): Promise<GeminiAnalysisResult> {
  if (frames.length === 0) {
    throw new Error("analyzeSwing requires at least one frame image");
  }

  const ai = getClient();
  const contents = [
    { text: `${SYSTEM_PROMPT}\n\nPitch context for these frames:\n${pitchContext}` },
    ...frames.map((f) => ({ inlineData: { data: f.data.toString("base64"), mimeType: f.mimeType } })),
  ];

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned no text content");
  }
  const parsed = JSON.parse(text) as {
    checklist: GeminiChecklistDraft[];
    issues: GeminiIssueDraft[];
    comps: GeminiCompDraft[];
    compNotes: string[];
    drills: GeminiDrillDraft[];
  };
  return { ...parsed, source: "gemini" };
}
