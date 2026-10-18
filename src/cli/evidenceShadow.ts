/**
 * PR10 (Revision 2 S0-11) worker integration, SHADOW ONLY.
 *
 * Observes artifacts the legacy pipeline already wrote for this processing
 * attempt, records a private V1-V4 assessment (PR9 table), and after the
 * unchanged AI run links that run and records a non-displayable claim decision
 * per issue. It decodes no media, runs no model, and never touches
 * swing_detection_state, report text, review status, focus or notifications.
 *
 * Isolation contract: every entry point resolves (never rejects) and every
 * database step is time-bounded, so a missing migration, a bad flag value, a
 * stale or absent artifact, a deleted clip or a database error can only skip
 * shadow work - never delay indefinitely, fail or alter the legacy report.
 * Logs carry fixed codes and the clip UUID only (no names, paths, payloads).
 */
import fs from "node:fs";
import path from "node:path";
import { readAnalysisFlags } from "../services/config/analysisFlags.js";
import { buildClaimDecisionRecordV2, buildShadowAssessment, type ShadowArtifacts, type ShadowPackageAccounting, type ShadowSupplyAccounting } from "../services/development/evidence/shadowAssessment.js";
import type { AiInputNames } from "../services/development/evidence/artifactSignals.js";
import { supabaseEvidenceShadowDb, type EvidenceShadowDb } from "../services/db/evidenceAssessmentStore.js";
import { getSupabaseClient } from "../services/db/supabaseClient.js";

import { buildEvidencePackage, suppliedEvidenceForV3, type EvidencePackageInput } from "../services/ai/evidencePackage.js";
import type { AnalysisInput } from "../services/ai/analysisContext.js";
import type { AnalysisImageDescriptor } from "./extract.js";

export type ShadowTransmission = { mode: "attested"; images: Array<{ name: string; sha256: string }> }
  | { mode: "unattested"; reason: "cli_backend_reads_directory" | "draft_file_no_transmission" };
export interface ShadowRunContext { input: AnalysisInput; transmission: ShadowTransmission }

export interface EvidenceShadowHandle {
  readonly assessmentId: string;
  /** Call after the legacy run is stored. Resolves even on failure. */
  afterRun(analysisRunId: string, context?: ShadowRunContext): Promise<void>;
}
export const SHADOW_DB_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([promise, new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  })]).finally(() => clearTimeout(timer));
}

/** A JSON artifact written during this attempt (mtime >= start), else null. */
function freshText(file: string, startedAt: number): string | null {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).mtimeMs < startedAt) return null;
    return fs.readFileSync(file, "utf8");
  } catch { return null; }
}
function parse(text: string | null): unknown {
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}
/** extract.ts image names (no paths), e.g. "phase_contact", "zoom_load". */
export function aiInputNames(stillsDir: string, counts: { sequenceFrames: number; sequenceSkipped: string | null }): AiInputNames {
  let files: string[] = [];
  try { files = fs.readdirSync(stillsDir); } catch { files = []; }
  const names = (prefix: string) => files.filter(f => f.startsWith(prefix) && /\.png$/i.test(f))
    .map(f => f.replace(/\.png$/i, "")).sort();
  return { phaseStills: names("phase_"), zooms: names("zoom_"),
    sequenceFrames: counts.sequenceFrames, sequenceSkipped: counts.sequenceSkipped };
}

export async function prepareEvidenceShadow(args: {
  videoClipId: string; outDir: string; stillsDir: string; metrics: unknown;
  sourceSha256: string | null; pipelineStartedAt: number;
  images?: AnalysisImageDescriptor[];
  extraction: { sequenceFrames: number; sequenceSkipped: string | null };
  env?: (key: string) => unknown; db?: EvidenceShadowDb; log?: (line: string) => void; timeoutMs?: number;
}): Promise<EvidenceShadowHandle | null> {
  const log = args.log ?? ((line: string) => console.warn(line));
  const note = (code: string) => {
    try { log(`[evidence-shadow] ${code} (clip ${args.videoClipId})`); } catch { /* Diagnostics cannot fail the worker. */ }
  };
  const timeoutMs = args.timeoutMs ?? SHADOW_DB_TIMEOUT_MS;
  try {
    let mode: string;
    try {
      mode = readAnalysisFlags(args.env ?? ((key) => process.env[key])).evidenceGateMode;
    } catch {
      note("skipped: invalid_or_unauthorized_flags"); // includes enforce without an enforced tuple
      return null;
    }
    if (mode !== "shadow") return null; // off: no artifact read, no write, no log
    const artifacts: ShadowArtifacts = {
      metrics: args.metrics,
      pose2d: parse(freshText(path.join(args.outDir, "pose_2d.json"), args.pipelineStartedAt)),
      batPath: parse(freshText(path.join(args.outDir, "bat_path.json"), args.pipelineStartedAt)),
      manifest: parse(freshText(path.join(args.outDir, "engine_manifest.json"), args.pipelineStartedAt)),
      frameMapJson: freshText(path.join(args.outDir, "frame_map.json"), args.pipelineStartedAt),
      aiInputs: aiInputNames(args.stillsDir, args.extraction),
      captureProfile: null,
    };
    const built = await buildShadowAssessment({ videoClipId: args.videoClipId, sourceSha256: args.sourceSha256, artifacts });
    if (!built.ok) { note(`skipped: ${built.reason}`); return null; }
    const db = args.db ?? supabaseEvidenceShadowDb(getSupabaseClient());
    let assessmentId: string;
    try {
      assessmentId = await withTimeout(db.insertAssessment(built.row), timeoutMs);
    } catch (error) {
      note(`skipped: persistence_unavailable ${error instanceof Error && error.message === "timeout" ? "timeout" : "database_error"}`);
      return null;
    }
    note(`recorded ${built.row.clip_status}`);
    return {
      assessmentId,
      async afterRun(analysisRunId: string, context?: ShadowRunContext) {
        // One overall budget for the whole linkage, so per-step timeouts cannot
        // accumulate across issues and hold the worker; no write starts after it.
        const deadline = Date.now() + 2 * timeoutMs;
        const step = <T>(op: () => Promise<T>) => {
          const left = deadline - Date.now();
          return left > 0 ? withTimeout(op(), left) : Promise.reject(new Error("timeout"));
        };
        try {
          await step(() => db.linkRun(analysisRunId, assessmentId));
          const issues = await step(() => db.runIssues(analysisRunId));
          let pkg: ShadowPackageAccounting = { status: "package_unavailable", version: null, digest: null,
            frameMap: null, generated: 0, omitted: 0, errorCode: "MISSING_CONTEXT_OR_DESCRIPTORS" };
          const supply: ShadowSupplyAccounting = { status: "package_unavailable",
            sent: context?.transmission.mode === "attested" ? context.transmission.images.length : 0,
            counted: { stills: 0, zooms: 0, sequence: 0 }, exclusionReasons: [] };
          let supplied: ReturnType<typeof suppliedEvidenceForV3>["supplied"] = null;
          if (context && args.images) {
            try {
              const result = await step(() => buildEvidencePackage({ videoClipId: args.videoClipId,
                sourceSha256: args.sourceSha256!, imagesDir: args.stillsDir,
                // Package validation rejects any unrecognized legacy phase without guessing one.
                images: args.images as EvidencePackageInput["images"], manifest: artifacts.manifest,
                frameMapJson: artifacts.frameMapJson, metrics: artifacts.metrics, assessment: built.assessment,
                capture: { profile: null, limitations: [] }, analysisInput: context.input }));
              if (result.ok) {
                pkg = { status: "built", version: result.pkg.version, digest: result.digest,
                  frameMap: result.pkg.frameMap.status, generated: result.pkg.availability.generated.length,
                  omitted: result.pkg.availability.omitted.length, errorCode: null };
                const transmission = context.transmission;
                if (transmission.mode !== "attested") supply.status = "unattested";
                else if (!transmission.images.every(sent => result.pkg.images.some(image =>
                  image.name === sent.name && image.sha256 === sent.sha256))) supply.status = "transmission_mismatch";
                else {
                  const v3 = suppliedEvidenceForV3(result.pkg, { imageOrder: transmission.images.map(image => image.name) });
                  supplied = v3.supplied;
                  supply.status = "supplied";
                  supply.counted = { stills: Object.keys(supplied?.stills ?? {}).length,
                    zooms: Object.keys(supplied?.zooms ?? {}).length, sequence: supplied?.sequence.length ?? 0 };
                  supply.exclusionReasons = [...new Set(v3.exclusions.map(item => item.reason))].sort();
                }
              } else pkg.errorCode = packageErrorCode(result.error.code);
            } catch (error) {
              pkg.errorCode = error instanceof Error && error.message === "timeout" ? "TIMEOUT" : "PACKAGE_BUILD_FAILED";
            }
          }
          if (pkg.errorCode) note(`package_unavailable: ${pkg.errorCode}`);
          for (const issue of issues) {
            const decision = await step(() => buildClaimDecisionRecordV2(built.input, issue, assessmentId, pkg, supply, supplied));
            await step(() => db.recordClaimDecision(issue.id, analysisRunId, decision));
          }
        } catch (error) {
          note(`run linkage incomplete: ${error instanceof Error && error.message === "timeout" ? "timeout" : "database_error"}`);
        }
      },
    };
  } catch {
    note("skipped: unexpected_error");
    return null;
  }
}

/** PR12 errors may suffix an image name; only known fixed codes may leave this module. */
function packageErrorCode(code: string): string {
  const fixed = code.split(":")[0]!;
  return ["INVALID_SOURCE_HASH", "SOURCE_MISMATCH", "UNSUPPORTED_VERSION", "ATTEMPT_MISMATCH",
    "INVALID_IMAGE_NAME", "DUPLICATE_IMAGE", "MALFORMED_IMAGE", "MISSING_IMAGE", "UNREADABLE_IMAGE",
    "MISSING_PTS", "IMAGE_DIRECTORY_UNAVAILABLE", "INVALID_PACKAGE"].includes(fixed) ? fixed : "PACKAGE_BUILD_FAILED";
}
