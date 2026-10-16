import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ISSUE_PHASES, type PhaseSlug } from "../../domain/swingPhases.ts";
import { LEGACY_EVENT_TARGETS, type LegacyField } from "../../domain/legacyPhaseMapping.ts";
import { BASELINE_ENGINE, engineCodeForPipelineVersion, isEvidenceTuple, type EvidenceTuple } from "../development/evidenceRegistry.ts";
import { EVIDENCE_EVENTS, verifiedFrameRows } from "../development/evidence/events.ts";
import { observedTuple } from "../development/evidence/shadowAssessment.ts";
import type { ClipEvidenceAssessment } from "../development/evidence/assessClip.ts";
import type { EventLocalisation, EvidenceEvent, SuppliedEvidence } from "../development/evidence/types.ts";
import type { AnalysisInput } from "./analysisContext.ts";

export const EVIDENCE_PACKAGE_VERSION = "evpkg-1.0.0";
export interface EvidenceImage {
  name: string; kind: "phase_still" | "zoom" | "swing_sequence"; phase: PhaseSlug | null;
  analysisFrame: number | null; identity: "verified" | "unverified" | "unavailable";
  rawFrame: number | null; rawPts: number | null; rawTimeBase: string | null; rawPtsS: number | null;
  identityReasons: string[]; assumed: { rawFrame: number | null; rawPtsS: number | null };
  orderInSwing: number; sha256: string; mimeType: "image/png" | "image/jpeg"; bytes: number;
  depiction: "unverified_by_name";
}
type PackageEvent = Pick<EventLocalisation, "status" | "rawFrame" | "rawPts" | "rawTimeBase" |
  "sourceField" | "method" | "engineConfidence" | "uncertaintyMs">;
export interface EvidencePackage {
  version: typeof EVIDENCE_PACKAGE_VERSION;
  clip: { videoClipId: string; sourceSha256: string };
  attempt: { runId: string | null; attemptNumber: number | null; inputSha256: string | null } | null;
  provenance: { engineCodeVersion: string | null; instrumentationVersion: string | null;
    environmentVersion: string | null; pipelineVersion: string | null; tuple: EvidenceTuple | null };
  frameMap: { status: "verified" | "unverified" | "absent"; reasons: string[] };
  events: Record<EvidenceEvent, PackageEvent> | null;
  assessment: ClipEvidenceAssessment | null;
  capture: { profile: string | null; limitations: string[] };
  images: EvidenceImage[];
  availability: { generated: string[]; notGenerated: Array<{ kind: EvidenceImage["kind"]; phase: PhaseSlug | null; reason: string }>;
    omitted: Array<{ name: string; reason: string }> };
  visibility: null; visibilityReason: "visibility_samples_not_defined";
  analysisInput: AnalysisInput; approval: "not_coach_reviewed";
}
/** Runtime only: never embed this map in a package, digest or diagnostic. */
export type PackageAssets = Map<string, string>;
export interface EvidencePackageInput {
  videoClipId: string; sourceSha256: string; imagesDir: string;
  images: Array<Pick<EvidenceImage, "name" | "kind" | "phase" | "analysisFrame"> & { assumed?: EvidenceImage["assumed"] }>;
  expected?: Array<{ kind: EvidenceImage["kind"]; phase: PhaseSlug | null; reason?: string }>;
  manifest?: unknown; frameMapJson?: string | null; metrics: unknown;
  assessment?: ClipEvidenceAssessment | null; capture?: EvidencePackage["capture"]; analysisInput: AnalysisInput;
}
type BuildResult = { ok: true; pkg: EvidencePackage; assets: PackageAssets; digest: string } |
  { ok: false; error: { code: string; detail: string[] } };
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const object = (v: unknown): Record<string, unknown> => record(v) ? v : {};
const str = (v: unknown): v is string => typeof v === "string";
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const index = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const hash = (v: unknown): v is string => str(v) && /^[a-f0-9]{64}$/.test(v);
const nullable = (check: (v: unknown) => boolean) => (v: unknown) => v === null || check(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const kinds = ["phase_still", "zoom", "swing_sequence"] as const;
const oneOf = (values: readonly unknown[]) => (v: unknown) => values.includes(v);
const phase = nullable(oneOf(ISSUE_PHASES));
const safeName = (v: unknown): v is string => str(v) && v.length > 0 && !/[\\/:]/.test(v) && !v.includes("..");
const imageName = (v: string) => [".png", ".jpg", ".jpeg"].includes(path.extname(v).toLowerCase());
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
/** Object keys are canonicalized recursively; array order remains meaningful. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(value => value === undefined ? "null" : canonical(value)).join(",")}]`;
  if (record(v)) return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const orderingPts = (image: EvidenceImage) => image.identity === "verified" ? image.rawPtsS : image.assumed.rawPtsS;
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export async function buildEvidencePackage(input: EvidencePackageInput): Promise<BuildResult> {
  const fail = (code: string, detail: string[] = []): BuildResult => ({ ok: false, error: { code, detail } });
  if (!hash(input.sourceSha256)) return fail("INVALID_SOURCE_HASH");
  const manifest = object(input.manifest), metrics = object(input.metrics);
  if (input.manifest !== undefined && input.manifest !== null) {
    if (manifest.input_sha256 !== input.sourceSha256) return fail("SOURCE_MISMATCH");
    if (manifest.schema_version !== 1 || manifest.instrumentation_version !== "inst-1"
      || manifest.engine_code_version !== BASELINE_ENGINE) return fail("UNSUPPORTED_VERSION");
  }
  if (engineCodeForPipelineVersion(metrics.pipeline_version) !== BASELINE_ENGINE) return fail("UNSUPPORTED_VERSION");
  const tuple = observedTuple(input.manifest);
  if (input.assessment && canonical(input.assessment.tuple) !== canonical(tuple)) return fail("ATTEMPT_MISMATCH");
  const names = new Set<string>();
  for (const descriptor of input.images) {
    if (!safeName(descriptor.name)) return fail("INVALID_IMAGE_NAME");
    if (names.has(descriptor.name)) return fail("DUPLICATE_IMAGE");
    names.add(descriptor.name);
  }
  const rows = await verifiedFrameRows({ frameMapJson: input.frameMapJson, manifest: input.manifest });
  const mapStatus = rows ? "verified" : input.frameMapJson != null ? "unverified" : "absent";
  const mapReasons = rows ? [] : [mapStatus === "absent" ? "FRAME_MAP_ABSENT" : "FRAME_MAP_UNVERIFIED"];
  const images: EvidenceImage[] = [], assets: PackageAssets = new Map();
  for (const descriptor of input.images) {
    const { name } = descriptor, file = path.resolve(input.imagesDir, name);
    if (!imageName(name)) return fail(`MALFORMED_IMAGE:${name}`);
    let data: Buffer;
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return fail(`MALFORMED_IMAGE:${name}`);
      data = await readFile(file);
    } catch (error) {
      return fail((error as NodeJS.ErrnoException).code === "ENOENT" ? `MISSING_IMAGE:${name}` : `UNREADABLE_IMAGE:${name}`);
    }
    const png = path.extname(name).toLowerCase() === ".png";
    if (!(png ? data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      : data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))) return fail(`MALFORMED_IMAGE:${name}`);
    const row = descriptor.analysisFrame === null ? undefined : rows?.get(descriptor.analysisFrame);
    const image: EvidenceImage = {
      name, kind: descriptor.kind, phase: descriptor.phase, analysisFrame: descriptor.analysisFrame,
      identity: rows ? row ? "verified" : "unavailable" : "unverified",
      rawFrame: row ? row.raw_frame as number : null, rawPts: row ? row.raw_pts as number : null,
      rawTimeBase: row ? row.raw_time_base as string : null, rawPtsS: row ? row.raw_pts_s as number : null,
      identityReasons: rows ? row ? [] : ["FRAME_ROW_UNAVAILABLE"] : [...mapReasons],
      assumed: descriptor.assumed ? { ...descriptor.assumed } : { rawFrame: null, rawPtsS: null },
      orderInSwing: 0, sha256: sha(data), bytes: data.length, mimeType: png ? "image/png" : "image/jpeg",
      depiction: "unverified_by_name",
    };
    if (!finite(orderingPts(image))) return fail(`MISSING_PTS:${name}`);
    images.push(image); assets.set(name, file);
  }
  images.sort((a, b) => orderingPts(a)! - orderingPts(b)! || kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || compareText(a.name, b.name));
  images.forEach((image, i) => { image.orderInSwing = i; });
  let entries: string[];
  try { entries = (await readdir(input.imagesDir, { withFileTypes: true }))
    .filter(entry => (entry.isFile() || entry.isSymbolicLink()) && imageName(entry.name)).map(entry => entry.name).sort(); }
  catch { return fail("IMAGE_DIRECTORY_UNAVAILABLE"); }
  const textOrNull = (v: unknown) => str(v) ? v : null;
  const assessment = input.assessment ?? null;
  const pkg: EvidencePackage = {
    version: EVIDENCE_PACKAGE_VERSION, clip: { videoClipId: input.videoClipId, sourceSha256: input.sourceSha256 },
    attempt: input.manifest == null ? null : { runId: textOrNull(manifest.run_id),
      attemptNumber: index(manifest.attempt_number) ? manifest.attempt_number : null, inputSha256: textOrNull(manifest.input_sha256) },
    provenance: { engineCodeVersion: textOrNull(manifest.engine_code_version), instrumentationVersion: textOrNull(manifest.instrumentation_version),
      environmentVersion: textOrNull(manifest.environment_version), pipelineVersion: textOrNull(metrics.pipeline_version), tuple },
    frameMap: { status: mapStatus, reasons: mapReasons },
    events: assessment ? Object.fromEntries(EVIDENCE_EVENTS.map(key => {
      const e = assessment.events[key];
      return [key, { status: e.status, rawFrame: e.rawFrame, rawPts: e.rawPts, rawTimeBase: e.rawTimeBase,
        sourceField: e.sourceField, method: e.method, engineConfidence: e.engineConfidence, uncertaintyMs: e.uncertaintyMs }];
    })) as EvidencePackage["events"] : null,
    assessment, capture: input.capture ?? { profile: null, limitations: [] }, images,
    availability: { generated: entries,
      notGenerated: (input.expected ?? []).filter(e => !images.some(i => i.kind === e.kind && i.phase === e.phase))
        .map(e => ({ kind: e.kind, phase: e.phase, reason: e.reason ?? "not_generated" })),
      omitted: entries.filter(name => !names.has(name)).map(name => ({ name, reason: "undeclared" })) },
    visibility: null, visibilityReason: "visibility_samples_not_defined", analysisInput: input.analysisInput, approval: "not_coach_reviewed",
  };
  const validation = validateEvidencePackage(pkg);
  if (!validation.valid) return fail("INVALID_PACKAGE", validation.errors);
  // Snapshot caller-owned objects so later mutations cannot silently invalidate the returned digest.
  const snapshot: EvidencePackage = JSON.parse(canonical(pkg));
  return { ok: true, pkg: snapshot, assets, digest: sha(canonical(snapshot)) };
}

/** Runtime validation also scans opaque analysis/assessment payloads for local paths.
 * Diagnostics use fixed schema codes, never caller content or property names. */
export function validateEvidencePackage(pkg: unknown): { valid: boolean; errors: string[] } {
  const errors = new Set<string>();
  const requireShape = (v: unknown, checks: Record<string, (v: unknown) => boolean>, code: string) => {
    if (!record(v) || !Object.entries(checks).every(([k, check]) => Object.hasOwn(v, k) && check(v[k]))) errors.add(code);
  };
  const seen = new Set<object>();
  function scan(v: unknown): void {
    if (str(v) && (path.posix.isAbsolute(v) || path.win32.isAbsolute(v)
      || /(?:file:\/\/|(?:^|[\s"'(=])(?:[a-z]:[\\/]|\\\\|\/(?!\/)[\w.~]))/i.test(v))) errors.add("ABSOLUTE_PATH");
    if (typeof v === "number" && !Number.isFinite(v) || typeof v === "bigint" || typeof v === "function" || typeof v === "symbol") errors.add("NOT_JSON");
    if (v && typeof v === "object") {
      if (seen.has(v)) { errors.add("CYCLIC_VALUE"); return; }
      seen.add(v);
      for (const [k, value] of Object.entries(v)) { if (k === "path") errors.add("PATH_FIELD"); scan(value); }
      seen.delete(v);
    }
  }
  scan(pkg);
  const p = object(pkg);
  requireShape(pkg, { version: v => v === EVIDENCE_PACKAGE_VERSION, clip: record, attempt: nullable(record), provenance: record,
    frameMap: record, events: nullable(record), assessment: nullable(record), capture: record, images: Array.isArray,
    availability: record, visibility: v => v === null, visibilityReason: v => v === "visibility_samples_not_defined",
    analysisInput: record, approval: v => v === "not_coach_reviewed" }, "PACKAGE_SCHEMA");
  requireShape(p.clip, { videoClipId: str, sourceSha256: hash }, "CLIP_SCHEMA");
  if (p.attempt !== null) requireShape(p.attempt, { runId: nullable(str), attemptNumber: nullable(index), inputSha256: nullable(hash) }, "ATTEMPT_SCHEMA");
  requireShape(p.provenance, { engineCodeVersion: nullable(str), instrumentationVersion: nullable(str), environmentVersion: nullable(str),
    pipelineVersion: nullable(str), tuple: nullable(isEvidenceTuple) }, "PROVENANCE_SCHEMA");
  requireShape(p.frameMap, { status: oneOf(["verified", "unverified", "absent"]), reasons: strings }, "FRAME_MAP_SCHEMA");
  requireShape(p.capture, { profile: nullable(str), limitations: strings }, "CAPTURE_SCHEMA");
  const eventChecks = { status: oneOf(["pass", "fail", "not_produced", "unmappable"]), rawFrame: nullable(index),
    rawPts: nullable(Number.isSafeInteger), rawTimeBase: nullable(str), sourceField: nullable(str), method: nullable(str),
    engineConfidence: nullable(str), uncertaintyMs: (v: unknown) => v === null };
  if (p.events !== null) for (const key of EVIDENCE_EVENTS) requireShape(object(p.events)[key], eventChecks, "EVENT_SCHEMA");
  if (p.assessment !== null) {
    requireShape(p.assessment, { tuple: nullable(isEvidenceTuple), subject: record, events: record,
      clipStatus: oneOf(["eligible", "withhold"]), familyReason: nullable(oneOf(["batter_unclear", "swing_unclear", "analysis_version_unavailable"])),
      strictBaseline: record }, "ASSESSMENT_SCHEMA");
    for (const key of EVIDENCE_EVENTS) requireShape(object(object(p.assessment).events)[key], { ...eventChecks,
      event: v => v === key, rawPtsS: nullable(finite), reasons: strings }, "ASSESSMENT_EVENT_SCHEMA");
    const assessment = object(p.assessment), subject = object(assessment.subject);
    requireShape(assessment.subject, { status: oneOf(["pass", "fail"]), reasons: strings, gateVersion: str,
      signals: record, thresholds: nullable(record) }, "SUBJECT_SCHEMA");
    const boolean = (v: unknown) => typeof v === "boolean";
    const fraction = (v: unknown) => finite(v) && v >= 0 && v <= 1;
    requireShape(subject.signals, { usedFallback: nullable(boolean), batEvidenceFrames: nullable(index), trackFrames: nullable(index),
      trackedFraction: nullable(fraction), identityJumpFraction: nullable(fraction), batterCropAvailable: nullable(boolean),
      windowAvailable: nullable(boolean) }, "SUBJECT_SIGNALS_SCHEMA");
    const thresholds = { minBatEvidenceFrames: nullable(index), minBatEvidenceFraction: nullable(fraction),
      minTrackedFraction: nullable(fraction), maxIdentityJumpFraction: nullable(fraction) };
    if (subject.thresholds !== null) requireShape(subject.thresholds, { version: str, ...thresholds }, "SUBJECT_THRESHOLDS_SCHEMA");
    requireShape(assessment.strictBaseline, { version: str, status: oneOf(["eligible", "withhold"]),
      scope: v => v === "shadow_comparator_only", approvedForProduction: v => v === false, evaluated: boolean,
      reasons: strings, failedRules: strings, familyReason: nullable(oneOf(["batter_unclear", "swing_unclear"])),
      familyReasons: strings, unmappedFamilyRules: strings, invalidSignals: strings, thresholds: record,
      requiredBatEvidenceFrames: nullable(finite) }, "STRICT_BASELINE_SCHEMA");
    requireShape(object(assessment.strictBaseline).thresholds, { ...thresholds, maxJumpBodyHeights: finite }, "STRICT_THRESHOLDS_SCHEMA");
  }
  const names = new Set<string>();
  let previous = -Infinity;
  if (Array.isArray(p.images)) p.images.forEach((value, i) => {
    requireShape(value, { name: safeName, kind: oneOf(kinds), phase, analysisFrame: nullable(index),
      identity: oneOf(["verified", "unverified", "unavailable"]), rawFrame: nullable(index), rawPts: nullable(Number.isSafeInteger),
      rawTimeBase: nullable(str), rawPtsS: nullable(finite), identityReasons: strings, assumed: record, orderInSwing: v => v === i,
      sha256: hash, mimeType: oneOf(["image/png", "image/jpeg"]), bytes: index, depiction: v => v === "unverified_by_name" }, "IMAGE_SCHEMA");
    const v = object(value);
    requireShape(v.assumed, { rawFrame: nullable(index), rawPtsS: nullable(finite) }, "ASSUMED_SCHEMA");
    if (str(v.name)) { if (names.has(v.name)) errors.add("DUPLICATE_IMAGE"); names.add(v.name); }
    const pts = v.identity === "verified" ? v.rawPtsS : object(v.assumed).rawPtsS;
    if (!finite(pts) || pts < previous) errors.add("NON_MONOTONE_ORDER");
    else previous = pts;
    if (v.identity === "verified" ? !index(v.rawFrame) || !Number.isSafeInteger(v.rawPts) || !str(v.rawTimeBase) || !finite(v.rawPtsS)
      : [v.rawFrame, v.rawPts, v.rawTimeBase, v.rawPtsS].some(x => x !== null)) errors.add("IDENTITY_SCHEMA");
  });
  requireShape(p.availability, { generated: strings, notGenerated: Array.isArray, omitted: Array.isArray }, "AVAILABILITY_SCHEMA");
  const availability = object(p.availability);
  if (Array.isArray(availability.notGenerated)) for (const v of availability.notGenerated) requireShape(v, { kind: oneOf(kinds), phase, reason: str }, "NOT_GENERATED_SCHEMA");
  if (Array.isArray(availability.omitted)) for (const v of availability.omitted) requireShape(v, { name: safeName, reason: str }, "OMITTED_SCHEMA");
  const a = object(p.analysisInput);
  requireShape(p.analysisInput, { player: record, pitch: record, swing: record, coachReviewedDecisions: Array.isArray,
    knowledgePack: str, knowledgeClaimIds: strings, knowledgeVersion: str }, "ANALYSIS_INPUT_SCHEMA");
  requireShape(a.player, { sport: nullable(oneOf(["baseball", "softball"])), level: nullable(str),
    ageBand: nullable(oneOf(["u8", "8-10", "11-12", "13-14", "15-18", "adult"])), bats: nullable(oneOf(["L", "R", "S"])), throws: nullable(oneOf(["L", "R"])) }, "PLAYER_SCHEMA");
  requireShape(a.pitch, { location: nullable(str), zone: nullable(finite), count: nullable(record), outcome: nullable(str),
    swung: nullable(v => typeof v === "boolean"), pitchType: nullable(str) }, "PITCH_SCHEMA");
  if (object(a.pitch).count !== null) requireShape(object(a.pitch).count, { balls: finite, strikes: finite }, "COUNT_SCHEMA");
  requireShape(a.swing, { frameNames: strings, pipelineVersion: nullable(str), metrics: record,
    reconstructionSupplied: v => typeof v === "boolean", excludedMeasurements: Array.isArray }, "SWING_SCHEMA");
  const swing = object(a.swing);
  if (Array.isArray(swing.excludedMeasurements)) for (const value of swing.excludedMeasurements) {
    requireShape(value, { field: str, reason: str }, "EXCLUSION_SCHEMA");
  }
  if (Array.isArray(a.coachReviewedDecisions)) for (const value of a.coachReviewedDecisions) {
    requireShape(value, { concept: nullable(str), phase: nullable(str), videoClipId: nullable(str), status: str }, "COACH_DECISION_SCHEMA");
  }
  if (a.atBatResult !== undefined && !nullable(oneOf(["hit", "out", "walk", "strikeout"]))(a.atBatResult)) errors.add("AT_BAT_SCHEMA");
  if (swing.context !== undefined && !oneOf(["game", "practice", "unknown"])(swing.context)) errors.add("CONTEXT_SCHEMA");
  if (a.knowledgeClaimExclusions !== undefined && (!record(a.knowledgeClaimExclusions)
    || !Object.values(a.knowledgeClaimExclusions).every(str))) errors.add("KNOWLEDGE_EXCLUSIONS_SCHEMA");
  return { valid: errors.size === 0, errors: [...errors].sort() };
}

export function describePackageForLog(pkg: EvidencePackage) {
  return { version: EVIDENCE_PACKAGE_VERSION, frameMapStatus: pkg.frameMap.status,
    images: pkg.images.length, verified: pkg.images.filter(i => i.identity === "verified").length,
    unverified: pkg.images.filter(i => i.identity === "unverified").length,
    unavailable: pkg.images.filter(i => i.identity === "unavailable").length,
    notGenerated: pkg.availability.notGenerated.length, omitted: pkg.availability.omitted.length,
    assessment: pkg.assessment ? "present" : "absent", approval: "not_coach_reviewed" as const };
}

export function suppliedEvidenceForV3(pkg: EvidencePackage | null, rendered: { imageOrder: string[] } | null): {
  status: "package_unavailable" | "not_supplied" | "supplied"; supplied: SuppliedEvidence | null;
  exclusions: Array<{ name: string; reason: string }>; approval: "not_coach_reviewed";
} {
  const approval = "not_coach_reviewed" as const;
  if (!pkg) return { status: "package_unavailable", supplied: null, exclusions: [], approval };
  if (!rendered) return { status: "not_supplied", supplied: null,
    exclusions: pkg.images.map(i => ({ name: i.name, reason: "not_sent" })), approval };
  const supplied: SuppliedEvidence = { stills: {}, zooms: {}, sequence: [], captureProfile: pkg.capture.profile };
  const sequence: Array<{ frame_index: number; pts: number }> = [], exclusions: Array<{ name: string; reason: string }> = [];
  const sent = new Set(rendered.imageOrder);
  for (const image of pkg.images) {
    let reason: string | null = null;
    if (!sent.has(image.name)) reason = "not_sent";
    else if (image.identity !== "verified") reason = `identity_${image.identity}`;
    else {
      const frame = { frame_index: image.rawFrame!, pts: image.rawPts! };
      if (image.kind === "swing_sequence") sequence.push(frame);
      else {
        const event = image.phase === null ? undefined : LEGACY_EVENT_TARGETS[`phases.${image.phase}` as LegacyField];
        const binding = event ? pkg.events?.[event] : undefined;
        if (!event || binding?.status !== "pass" || binding.rawFrame !== image.rawFrame || binding.rawPts !== image.rawPts) reason = "not_bound_to_verified_event";
        else (image.kind === "zoom" ? supplied.zooms : supplied.stills)[event] = frame;
      }
    }
    if (reason) exclusions.push({ name: image.name, reason });
  }
  supplied.sequence = sequence.sort((a, b) => a.pts - b.pts);
  return { status: "supplied", supplied, exclusions, approval };
}
