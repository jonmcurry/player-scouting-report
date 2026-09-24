/**
 * Local-testing alternative to geminiAnalyzer.ts: shells out to the
 * `claude` CLI (@anthropic-ai/claude-code, installed globally) in
 * non-interactive print mode instead of calling an API with a metered key.
 * `claude` reuses whatever auth is already on the machine (this dev
 * machine's Claude subscription login, confirmed via `~/.claude/
 * .credentials.json` - not a separate ANTHROPIC_API_KEY), which is the
 * whole point: analysis runs during local development without needing a
 * working Gemini key or paying for separate API usage. Selected via
 * processUploadQueue.ts's AI_ANALYZER=claude-cli env var - production
 * deployments should stay on geminiAnalyzer.ts (the default), since a
 * shelled-out CLI tied to one developer's interactive subscription login
 * isn't a real server-side credential.
 *
 * Unlike Gemini's inline base64 image bytes + native responseSchema
 * enforcement, this hands the CLI a prompt with real file paths and lets
 * its own Read tool load the images (confirmed working - a real test call
 * against contact_sheet.png returned an accurate, specific description of
 * what was actually in frame). Structured output is prompt-enforced
 * (SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS) rather than schema-enforced,
 * since `claude -p` has no native equivalent to Gemini's responseSchema -
 * parsing defensively strips a markdown code fence if the model adds one
 * anyway.
 *
 * VERIFICATION STATUS: the CLI invocation pattern (spawn, --output-format
 * json, --allowedTools Read, envelope shape, image-reading capability) was
 * checked against a real call this session. The FULL analyzeSwingViaCli()
 * path (real phase stills -> structured JSON matching this project's exact
 * schema) has not yet been run end-to-end - verify against a real clip
 * before trusting its output the way geminiAnalyzer.ts's Gemini call still
 * needs its own first real run too.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AnalysisInput } from "./analysisContext.js";
import {
  SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS,
  renderSwingAnalysisPrompt,
  validateSwingAnalysisResult,
  type SwingAnalysisResult,
} from "./swingAnalysisShared.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
function getConfiguredClaudeModel(): string {
  const model = process.env.CLAUDE_CLI_MODEL?.trim();
  if (!model) throw new Error("CLAUDE_CLI_MODEL must be explicitly configured when AI_ANALYZER=claude-cli");
  return model;
}
// A real, generous ceiling - a single-shot vision analysis over a handful of
// stills shouldn't ever need this long, but a hung/looping CLI call must not
// wedge the upload-processing worker forever.
const TIMEOUT_MS = 5 * 60_000;

/** Real behavior confirmed by an actual run, not a hypothetical: despite
 * SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS explicitly asking for no text
 * before or after the JSON, the model appended a genuinely useful trailing
 * note in prose after the closing fence (flagging that several extracted
 * stills were near-duplicate frames - exactly the kind of honest caveat this
 * whole project already values, not noise). An end-anchored regex rejected
 * the entire response over that, throwing away a complete, valid JSON body
 * along with a real insight. Now finds the FIRST fenced (or, if unfenced,
 * the first brace-balanced) JSON object anywhere in the text and returns
 * anything after it separately, so the caller can log it instead of losing
 * it - see analyzeSwingViaClaudeCli's use below. */
function extractJson(text: string): { json: string; trailingNote: string | null } {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    const trailing = trimmed.slice(fenced.index! + fenced[0].length).trim();
    return { json: fenced[1]!.trim(), trailingNote: trailing || null };
  }
  // No fence at all - fall back to matching the first balanced {...} object,
  // in case the model returned raw JSON with trailing prose but no fence.
  const start = trimmed.indexOf("{");
  if (start === -1) return { json: trimmed, trailingNote: null };
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === "{") depth++;
    else if (trimmed[i] === "}") {
      depth--;
      if (depth === 0) {
        return { json: trimmed.slice(start, i + 1), trailingNote: trimmed.slice(i + 1).trim() || null };
      }
    }
  }
  return { json: trimmed, trailingNote: null };
}

interface ClaudeCliEnvelope {
  is_error: boolean;
  result?: string;
  subtype?: string;
  permission_denials?: unknown[];
  /** Keyed by the concrete model IDs the CLI actually billed for this call -
   * the only place `--model sonnet` (an alias) resolves to a real ID. The CLI
   * can also bill a small auxiliary model for its own housekeeping, so this
   * may list more than one. */
  modelUsage?: Record<string, unknown>;
}

/** Concrete model IDs from the envelope, sorted, comma-joined; null if the CLI
 * reported none. Stored as analysis_runs.ai_model_version so a run records
 * what the alias resolved to, not just the alias. */
export function resolvedModelIds(envelope: Pick<ClaudeCliEnvelope, "modelUsage">): string | null {
  const ids = Object.keys(envelope.modelUsage ?? {}).sort();
  return ids.length ? ids.join(",") : null;
}

function runClaudeCli(prompt: string, cwd: string, model: string): Promise<ClaudeCliEnvelope> {
  return new Promise((resolve, reject) => {
    // The prompt is piped via stdin, never passed as an argv element - on
    // Windows `claude` resolves to a .cmd shim (confirmed:
    // C:\Users\<user>\AppData\Roaming\npm\claude.cmd), which spawn() can only
    // launch through a real shell (shell: true). Node's own docs warn that
    // combining shell:true with an args ARRAY does not escape those args,
    // just concatenates them - confirmed as a REAL bug here, not a
    // theoretical one: passing this file's huge multi-line prompt as an argv
    // element got mangled by cmd.exe's parsing badly enough that `claude`
    // received no usable prompt at all and fell back to generic ambient-
    // context chatter instead of the actual analysis request. Only short,
    // shell-safe flag tokens go in the args array now; the prompt goes to
    // stdin instead, which needs no shell quoting at all.
    const child = spawn(
      "claude",
      ["-p", "--output-format", "json", "--allowedTools", "Read", "--model", model],
      { cwd, shell: process.platform === "win32" },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude CLI timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude CLI - is @anthropic-ai/claude-code installed globally? (${err.message})`));
    });
    child.stdin.end(prompt);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ClaudeCliEnvelope);
      } catch {
        reject(new Error(`claude CLI's --output-format json wasn't valid JSON: ${stdout.slice(0, 500)}`));
      }
    });
  });
}

/**
 * @param framesDir directory of frame stills (e.g. from
 *   extract.ts's extractPhaseStills) - passed as real file paths in the
 *   prompt, not read into memory here, since the CLI reads them itself.
 * @param pitchContext same shape as geminiAnalyzer.ts's analyzeSwing.
 */
export async function analyzeSwingViaClaudeCli(
  framesDir: string,
  input: AnalysisInput,
  // Optional extra evidence instructions (e.g. how paired views of one instant
  // relate). Omitted by the production path, so its prompt is unchanged; any
  // caller that sets it must record its own prompt version.
  opts: { evidenceAddendum?: string } = {},
): Promise<SwingAnalysisResult> {
  const files = fs
    .readdirSync(framesDir)
    .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort();
  if (files.length === 0) {
    throw new Error(`No image files found in ${framesDir}`);
  }

  const repoRoot = process.cwd();
  const model = getConfiguredClaudeModel();
  const relPaths = files.map((f) => path.relative(repoRoot, path.join(framesDir, f)));
  const prompt = [
    renderSwingAnalysisPrompt(input),
    ...(opts.evidenceAddendum ? ["", opts.evidenceAddendum] : []),
    "",
    `Read each of these ${relPaths.length} frame image(s) before answering:`,
    ...relPaths.map((p) => `- ${p}`),
    "",
    SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS,
  ].join("\n");

  const envelope = await runClaudeCli(prompt, repoRoot, model);
  if (envelope.is_error || !envelope.result) {
    throw new Error(`claude CLI reported an error: ${JSON.stringify(envelope).slice(0, 500)}`);
  }
  if (envelope.permission_denials && envelope.permission_denials.length > 0) {
    console.warn(
      `[claudeCliAnalyzer] claude CLI hit ${envelope.permission_denials.length} permission denial(s) - ` +
        `analysis may be based on incomplete tool access: ${JSON.stringify(envelope.permission_denials).slice(0, 300)}`,
    );
  }

  const { json: jsonText, trailingNote } = extractJson(envelope.result);
  if (trailingNote) {
    console.warn(`[claudeCliAnalyzer] claude added prose alongside the JSON (not lost, just not structured data): ${trailingNote}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`claude CLI's response text wasn't valid JSON after extracting it: ${jsonText.slice(0, 500)}`);
  }
  return validateSwingAnalysisResult(parsed, {
    source: "claude",
    aiModel: model,
    aiModelVersion: resolvedModelIds(envelope),
    allowedKnowledgeClaimIds: input.knowledgeClaimIds,
    availableBases: ["video", ...(Object.keys(input.swing.metrics).length ? ["metric" as const] : []), ...(input.swing.reconstructionSupplied ? ["reconstruction" as const] : [])],
  });
}
