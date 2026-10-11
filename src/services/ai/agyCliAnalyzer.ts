/**
 * Local-testing alternative to geminiAnalyzer.ts, parallel to
 * claudeCliAnalyzer.ts: shells out to the Antigravity CLI (`agy`) in print
 * mode so local analysis runs on the developer's own Antigravity login
 * instead of a metered GEMINI_API_KEY. Selected via processUploadQueue.ts's
 * AI_ANALYZER=agy-cli. Production must stay on geminiAnalyzer.ts: an
 * interactive developer login is not a server-side credential.
 *
 * Privacy gate: these stills show a real child. geminiAnalyzer.ts refuses to
 * send them unless GEMINI_PAID_SERVICE_CONFIRMED=true, because the unpaid
 * Gemini API terms prohibit personal information. agy sends them under the
 * logged-in Antigravity account's terms instead, which that confirmation does
 * not cover - so this path has its own explicit opt-in,
 * AGY_ANALYZER_DATA_CONFIRMED=true, and refuses to run without it.
 *
 * `agy --mode plan` keeps the agent read-only; it loads the stills itself with
 * view_file from the repo-relative paths in the prompt. Structured output is
 * prompt-enforced (SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS) and then held to the
 * same strict validator as every other backend, so malformed output writes
 * nothing.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DraftSource } from "../../types/scouting.js";
import type { AnalysisInput } from "./analysisContext.js";
import { extractJson } from "./claudeCliAnalyzer.js";
import {
  SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS,
  renderSwingAnalysisPrompt,
  validateSwingAnalysisResult,
  validationContext,
  type SwingAnalysisResult,
} from "./swingAnalysisShared.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const TIMEOUT_S = 300;
// agy.exe is a real executable (no .cmd shim), so the prompt can go in argv
// without shell quoting - but Windows caps a whole command line at 32,767 chars.
const MAX_PROMPT_CHARS = 30_000;

export function getConfiguredAgyModel(env: NodeJS.ProcessEnv = process.env): string {
  const model = env.AGY_ANALYZER_MODEL?.trim();
  if (!model) throw new Error("AGY_ANALYZER_MODEL must be explicitly configured when AI_ANALYZER=agy-cli (see `agy models`)");
  return model;
}

export function requireAgyDataConfirmation(env: NodeJS.ProcessEnv = process.env): void {
  if (env.AGY_ANALYZER_DATA_CONFIRMED !== "true") {
    throw new Error(
      "AI_ANALYZER=agy-cli sends player swing images to Google through the logged-in Antigravity account. " +
        "Set AGY_ANALYZER_DATA_CONFIRMED=true only after confirming that account's data terms are acceptable for this footage.",
    );
  }
}

/** The DraftSource stored with the run is the model family that actually answered. */
export function agyModelSource(model: string): DraftSource {
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "claude";
  throw new Error(`AGY_ANALYZER_MODEL "${model}" has no matching analysis source; use a gemini-* or claude-* model`);
}

interface AgyEnvelope {
  status?: string;
  response?: string;
}

/** Anything but a SUCCESS envelope with a response - including a print timeout,
 * which agy reports with exit code 0 - is a failed analysis, never partial data. */
export function agyResponseText(stdout: string): string {
  let envelope: AgyEnvelope;
  try {
    envelope = JSON.parse(stdout) as AgyEnvelope;
  } catch {
    throw new Error(`agy --output-format json wasn't valid JSON: ${stdout.slice(0, 500)}`);
  }
  if (envelope.status !== "SUCCESS" || !envelope.response?.trim()) {
    throw new Error(`agy did not complete the analysis (status ${envelope.status ?? "missing"}): ${stdout.slice(0, 500)}`);
  }
  return envelope.response;
}

function runAgy(prompt: string, cwd: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "agy",
      ["--mode", "plan", "--model", model, "--output-format", "json", "--print-timeout", `${TIMEOUT_S}s`, "-p", prompt],
      { cwd },
    );
    let stdout = "";
    let stderr = "";
    // agy enforces --print-timeout itself; this only guards a CLI that hangs past it.
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`agy timed out after ${TIMEOUT_S + 60}s`));
    }, (TIMEOUT_S + 60) * 1000);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn agy - is the Antigravity CLI installed and on PATH? (${err.message})`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`agy exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(agyResponseText(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}

/** Same contract as analyzeSwingViaClaudeCli. */
export async function analyzeSwingViaAgy(
  framesDir: string,
  input: AnalysisInput,
  opts: { evidenceAddendum?: string } = {},
): Promise<SwingAnalysisResult> {
  requireAgyDataConfirmation();
  const model = getConfiguredAgyModel();
  const source = agyModelSource(model);
  const files = fs
    .readdirSync(framesDir)
    .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort();
  if (files.length === 0) throw new Error(`No image files found in ${framesDir}`);

  const repoRoot = process.cwd();
  const relPaths = files.map((f) => path.relative(repoRoot, path.join(framesDir, f)).replaceAll("\\", "/"));
  const prompt = [
    "You are analyzing a youth swing for a coaching report. Do not modify any files and do not run commands.",
    "",
    renderSwingAnalysisPrompt(input),
    ...(opts.evidenceAddendum ? ["", opts.evidenceAddendum] : []),
    "",
    `Open each of these ${relPaths.length} frame image(s) with view_file before answering, and open no other files:`,
    ...relPaths.map((p) => `- ${p}`),
    "",
    SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS,
  ].join("\n");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`agy analysis prompt is ${prompt.length} chars, over the ${MAX_PROMPT_CHARS}-char Windows command-line budget`);
  }

  const { json: jsonText, trailingNote } = extractJson(await runAgy(prompt, repoRoot, model));
  if (trailingNote) {
    console.warn(`[agyCliAnalyzer] agy added prose alongside the JSON (not lost, just not structured data): ${trailingNote}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`agy's response text wasn't valid JSON after extracting it: ${jsonText.slice(0, 500)}`);
  }
  return validateSwingAnalysisResult(parsed, {
    source,
    aiModel: `agy:${model}`,
    aiModelVersion: model,
    requireSimplifiedReport: true,
    ...validationContext(input),
  });
}
