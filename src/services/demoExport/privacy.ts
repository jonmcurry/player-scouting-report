/**
 * Publication gate for privacy-treated demo media (scripts/privacy/*.py;
 * docs/research/demo-privacy-video.md). A clip's media may be exported only
 * when ALL of these hold for the exact bytes being exported:
 *
 *   1. The anonymizer's summary exists and its status is not REJECT.
 *   2. The independent validator ran on the same output and did not FAIL
 *      (no timing, alignment, or fail-closed-frame failures).
 *   3. The file on disk hashes to the sha256 both reports recorded.
 *   4. A SEPARATE human approval record names that exact sha256 with
 *      decision "approve". For NEEDS_MANUAL_REVIEW it must also state
 *      resolvedReviewItems: true (the reviewer inspected every listed frame).
 *   5. Frame count equals the analyzed clip's frame count (the treated file
 *      IS the analysis window, frame for frame, so its media offset is 0).
 *   6. It is not the original recording (hash differs from the source).
 *
 * REJECT can never be approved. Local-validation fixtures may skip (4) only
 * because they can never be stored in a non-local database or synced to the
 * website - the gate records that explicitly instead of pretending approval.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type PrivacyStatus = "PASS_CANDIDATE" | "NEEDS_MANUAL_REVIEW" | "REJECT";

export interface PrivacySummary {
  name: string;
  status: PrivacyStatus;
  output: string;
  output_sha256: string;
  source_video_sha256: string;
  frames: number;
  analysis_frames: number;
  fps: number;
  scale_from_analysis_px: number;
  treatment: Record<string, unknown>;
  reject_reasons: string[];
  review_reasons: string[];
}
export interface PrivacyValidation {
  output: string;
  verdict: "CLEAN" | "FINDINGS" | "FAIL";
  hard_failures: string[];
  frames_with_findings: number[];
  timing: { frames: number; fps: number; duration: number };
  alignment: { median_err_frac: number | null };
}
export interface PrivacyApproval {
  clip: string;
  outputSha256: string;
  decision: "approve" | "reject";
  reviewedBy: string;
  reviewedAt: string;
  resolvedReviewItems?: boolean;
  notes?: string;
}

export interface PrivacyGateInput {
  summary: PrivacySummary | null;
  validation: PrivacyValidation | null;
  fileSha256: string | null;
  approval: PrivacyApproval | null;
  expectedFrames: number | null;
  localValidationOnly: boolean;
  /** Treated media IS the analysis window: the demo trim must start exactly there (offset 0). */
  analysisWindowStartS?: number | null;
  mediaTrimStartS?: number | null;
}

export interface PrivacyGateResult {
  ok: boolean;
  errors: string[];
  /** What the media manifest records (local audit only - no paths). */
  record: Record<string, unknown>;
}

export function evaluatePrivacyGate(g: PrivacyGateInput): PrivacyGateResult {
  const errors: string[] = [];
  const s = g.summary, v = g.validation, ap = g.approval;
  if (!s) errors.push("no privacy summary - the clip has not been privacy-treated");
  if (!v) errors.push("no independent validation report for this output");
  if (s?.status === "REJECT") errors.push(`privacy treatment REJECTED: ${s.reject_reasons.join("; ")}`);
  if (v?.verdict === "FAIL") errors.push(`independent validation FAILED: ${v.hard_failures.join("; ")}`);
  if (s && v && s.output !== v.output) errors.push(`validation report is for ${v.output}, summary is for ${s.output}`);
  if (s && g.fileSha256 !== s.output_sha256) errors.push("the treated file's sha256 does not match the privacy summary (changed after treatment)");
  if (s && g.fileSha256 === s.source_video_sha256) errors.push("the media file IS the original recording");
  if (s && s.frames !== s.analysis_frames) errors.push(`treated media has ${s.frames} frames, the analysis has ${s.analysis_frames}`);
  if (s && g.expectedFrames != null && s.frames !== g.expectedFrames) errors.push(`treated media has ${s.frames} frames, the clip record has ${g.expectedFrames}`);
  if (v && s && v.timing.frames !== s.frames) errors.push(`validator decoded ${v.timing.frames} frames, summary says ${s.frames}`);

  if (g.analysisWindowStartS === undefined || g.mediaTrimStartS === undefined || g.analysisWindowStartS === null || g.mediaTrimStartS === null) {
    errors.push("analysis window / media trim start unknown - treated media alignment can't be proven");
  } else if (Math.abs(g.analysisWindowStartS - g.mediaTrimStartS) > 1e-6) {
    errors.push(`treated media covers exactly the analysis window, so the trim must start at ${g.analysisWindowStartS}s (it starts at ${g.mediaTrimStartS}s) - phase markers would be misaligned`);
  }

  let approvalState: string;
  if (g.localValidationOnly) {
    approvalState = "none - local validation only (never publishable)";
  } else if (!ap) {
    errors.push("no human publication approval recorded for this exact file");
    approvalState = "missing";
  } else {
    approvalState = ap.decision;
    if (ap.decision !== "approve") errors.push(`human reviewer decision is "${ap.decision}"`);
    if (s && ap.outputSha256 !== s.output_sha256) errors.push("the human approval is for a different file (sha256 mismatch) - re-review the current output");
    if (!ap.reviewedBy?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(ap.reviewedAt ?? "")) errors.push("approval must name the reviewer and date (YYYY-MM-DD)");
    const needsResolution = s?.status === "NEEDS_MANUAL_REVIEW" || (v != null && v.verdict !== "CLEAN");
    if (needsResolution && ap.resolvedReviewItems !== true) {
      errors.push("clip has manual-review items (anonymizer flags and/or validator findings) - approval must set resolvedReviewItems: true after inspecting every listed frame");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    record: {
      treatedMedia: s?.output ?? null,
      treatedSha256: s?.output_sha256 ?? null,
      sourceSha256: s?.source_video_sha256 ?? null,
      treatment: s?.treatment ?? null,
      automatedStatus: s?.status ?? null,
      reviewReasons: s?.review_reasons ?? [],
      validation: v ? { verdict: v.verdict, framesWithFindings: v.frames_with_findings, alignmentMedianErr: v.alignment.median_err_frac } : null,
      frames: s?.frames ?? null,
      fps: s?.fps ?? null,
      scaleFromAnalysisPx: s?.scale_from_analysis_px ?? null,
      humanApproval: g.localValidationOnly ? null : ap ? { decision: ap.decision, reviewedBy: ap.reviewedBy, reviewedAt: ap.reviewedAt, resolvedReviewItems: ap.resolvedReviewItems === true } : null,
      approvalState,
      publishable: errors.length === 0 && !g.localValidationOnly,
    },
  };
}

function readJson<T>(file: string): T | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as T) : null;
}

export function sha256OfFile(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Loads <dir>/<name>.{summary,validation}.json, the treated mp4, and the matching approval. */
export function loadPrivacyGateInput(opts: {
  dir: string; name: string; approvalsFile: string | null; expectedFrames: number | null; localValidationOnly: boolean;
}): PrivacyGateInput & { mediaFile: string } {
  const summary = readJson<PrivacySummary>(path.join(opts.dir, `${opts.name}.summary.json`));
  const validation = readJson<PrivacyValidation>(path.join(opts.dir, `${opts.name}.validation.json`));
  const mediaFile = path.join(opts.dir, summary?.output ?? `${opts.name}.mp4`);
  const approvals = opts.approvalsFile ? readJson<{ approvals: PrivacyApproval[] }>(opts.approvalsFile) : null;
  const approval = approvals?.approvals.find((x) => x.clip === opts.name) ?? null;
  return { summary, validation, fileSha256: sha256OfFile(mediaFile), approval, expectedFrames: opts.expectedFrames, localValidationOnly: opts.localValidationOnly, mediaFile };
}
