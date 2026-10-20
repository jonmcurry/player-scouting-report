/**
 * Development-only evidence package for the experimental v2 engine (parallel to evpkg-1.0.0, which stays
 * baseline-only). Built from the engine's own artifacts: every image is checked against the frame map and
 * the M3 event it claims to show, ordered by source presentation time, and labelled with what was directly
 * observed at that frame. Interpolated bat geometry is never labelled as an observation, and the impact
 * estimate is never presented as confirmed contact.
 */
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

export const V2_EVIDENCE_PACKAGE_VERSION = "evpkg-v2-1.0.0";
export const V2_RENDER_VERSION = "render-v2-1.0.0";
/** M3 events mirrored into metrics.phases (docs/evaluation/engine-v2-m3.md). */
export const V2_EVENT_PHASES: Readonly<Record<string, string>> = Object.freeze({
  stance_set: "stance", load_peak_estimate: "load", foot_plant: "stride",
  impact_estimate: "contact", extension: "extension", finish: "follow_through",
});
/** Events timed from direct barrel observations; the rest are timed from the batter's pose. */
export const V2_BAT_EVENTS: ReadonlySet<string> = new Set(["impact_estimate", "finish"]);
export const V2_STATEMENTS = Object.freeze([
  "impact_estimate is the barrel's peak-speed frame, an estimate of passage through the hitting zone, never confirmed bat-ball contact",
  "contact_confirmed is never produced",
  "bat knob position, hand path and bat angle measurements are not available",
  "swing_launch and stride_foot_lift are not supplied (definition limitations)",
]);
const PTS_TOLERANCE_S = 1e-5;  // ffprobe prints 6 decimals; the frame map stores PTS-derived seconds to 6
const KINDS = ["phase_still", "zoom", "swing_sequence"] as const;

export type BatObservation = "direct" | "interpolated" | "not_observed";
export interface V2PackageEvent {
  id: string; phase: string | null; status: string; frame: number | null; pts: number | null; timeS: number | null;
  windowS: [number, number] | null; observation: "direct" | "pose" | null; downstreamUse: string | null;
  supported: boolean; reasons: string[];
}
export interface V2EvidenceImage {
  name: string; kind: (typeof KINDS)[number]; phase: string | null; eventId: string | null;
  sourceFrame: number; pts: number; timeS: number; batObservation: BatObservation; batterPose: boolean;
  sha256: string; mimeType: "image/png" | "image/jpeg"; bytes: number; order: number;
}
export interface V2EvidencePackage {
  version: typeof V2_EVIDENCE_PACKAGE_VERSION;
  clip: { videoClipId: string; sourceSha256: string };
  engine: { engine: string; pipelineVersion: string };
  identity: { batter: "selected"; basis: string };
  events: V2PackageEvent[];
  supportedEvents: string[];
  images: V2EvidenceImage[];
  excludedImages: Array<{ name: string; reason: string }>;
  statements: readonly string[];
  approval: "not_coach_reviewed";
}
export interface V2ImageDescriptor {
  name: string; kind: (typeof KINDS)[number]; phase: string | null; analysisFrame: number;
  assumed: { rawFrame: number; rawPtsS: number };
}
export interface V2PackageInput {
  videoClipId: string; sourceSha256: string; imagesDir: string; images: V2ImageDescriptor[];
  metrics: unknown; frameMap: unknown; batPath: unknown; pose2d: unknown; tracks: unknown;
}
export type V2PackageResult = { ok: true; pkg: V2EvidencePackage; assets: Map<string, string>; digest: string }
  | { ok: false; error: string };

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): Record<string, unknown> => record(v) ? v : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const index = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const safeName = (v: string) => v.length > 0 && !/[\\/:]/.test(v) && !v.includes("..");

/** Object keys sorted recursively; array order is meaningful. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (record(v)) return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

function packageEvents(metrics: Record<string, unknown>): V2PackageEvent[] {
  return list(metrics.events).filter(record).map((e) => {
    const id = String(e.id), phase = V2_EVENT_PHASES[id] ?? null, available = e.status === "available";
    const supported = available && e.downstream_use === "experimental" && phase !== null && index(e.frame);
    const given = list(e.reason_codes).map(String);
    const reasons = supported ? [] : !available ? (given.length ? given : ["UNAVAILABLE"])
      : phase === null ? ["NOT_A_COACHING_PHASE"] : e.downstream_use !== "experimental" ? ["NOT_FOR_DOWNSTREAM_USE"] : ["NO_SOURCE_FRAME"];
    const window = list(e.window_s);
    return { id, phase, status: String(e.status), frame: index(e.frame) ? e.frame : null, pts: index(e.pts) ? e.pts : null,
      timeS: finite(e.time_s) ? e.time_s : null,
      windowS: window.length === 2 && window.every(finite) ? [window[0] as number, window[1] as number] : null,
      observation: e.observation === "direct" || e.observation === "pose" ? e.observation : null,
      downstreamUse: typeof e.downstream_use === "string" ? e.downstream_use : null, supported, reasons };
  });
}

/** Phases the v2 path may extract stills for: only supported (available, experimental, mapped) events. */
export function v2PhaseFrames(metrics: unknown): Array<{ slug: string; frame: number }> {
  return packageEvents(obj(metrics)).filter(e => e.supported).map(e => ({ slug: e.phase!, frame: e.frame! }));
}

export async function buildV2EvidencePackage(input: V2PackageInput): Promise<V2PackageResult> {
  const fail = (error: string): V2PackageResult => ({ ok: false, error });
  if (!/^[a-f0-9]{64}$/.test(input.sourceSha256)) return fail("INVALID_SOURCE_HASH");
  const metrics = obj(input.metrics), frameMap = obj(input.frameMap), tracks = obj(input.tracks);
  if (typeof metrics.engine !== "string" || typeof metrics.pipeline_version !== "string") return fail("NOT_V2_ARTIFACTS");
  if (frameMap.input_sha256 !== input.sourceSha256) return fail("SOURCE_MISMATCH");
  const decision = obj(obj(tracks.grounding).final_decision);
  if (decision.status !== "selected" || decision.basis !== "pose_and_bat") return fail("BATTER_NOT_BAT_GROUNDED");
  const frames = new Map(list(frameMap.frames).filter(record).map(f => [f.index as number, f]));
  const bats = new Map(list(obj(input.batPath).frames).filter(record).map(f => [f.frame as number, f]));
  const poses = new Map(list(obj(input.pose2d).frames).filter(record).map(f => [f.frame as number, f]));
  const events = packageEvents(metrics);
  const byPhase = new Map(events.filter(e => e.supported).map(e => [e.phase!, e]));

  const images: V2EvidenceImage[] = [], excluded: Array<{ name: string; reason: string }> = [], assets = new Map<string, string>();
  const names = new Set<string>();
  for (const d of input.images) {
    if (!safeName(d.name) || names.has(d.name)) return fail("INVALID_IMAGE_NAME");
    names.add(d.name);
    const exclude = (reason: string) => { excluded.push({ name: d.name, reason }); };
    // v2 decodes the original upload directly: the analysed index is the source presentation index.
    const row = frames.get(d.analysisFrame);
    if (!row || d.assumed.rawFrame !== d.analysisFrame) { exclude("SOURCE_FRAME_MISMATCH"); continue; }
    if (!finite(row.time_s) || Math.abs(d.assumed.rawPtsS - (row.time_s as number)) > PTS_TOLERANCE_S) { exclude("PTS_MISMATCH"); continue; }
    let eventId: string | null = null;
    if (d.kind !== "swing_sequence") {
      const event = d.phase === null ? undefined : byPhase.get(d.phase);
      if (!event) { exclude("NO_SUPPORTED_EVENT_FOR_PHASE"); continue; }
      if (event.frame !== d.analysisFrame) { exclude("IMAGE_NOT_AT_EVENT_FRAME"); continue; }
      eventId = event.id;
    }
    const file = path.resolve(input.imagesDir, d.name);
    let data: Buffer;
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) { exclude("UNREADABLE_IMAGE"); continue; }
      data = await readFile(file);
    } catch { exclude("UNREADABLE_IMAGE"); continue; }
    const png = path.extname(d.name).toLowerCase() === ".png";
    if (!(png ? data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      : data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))) { exclude("MALFORMED_IMAGE"); continue; }
    const bat = obj(bats.get(d.analysisFrame));
    images.push({ name: d.name, kind: d.kind, phase: d.kind === "swing_sequence" ? null : d.phase, eventId,
      sourceFrame: d.analysisFrame, pts: row.pts as number, timeS: row.time_s as number,
      // Only a direct, identity-resolved bat detection is an observation; interpolation is labelled as such.
      batObservation: bat.status === "detected" ? "direct" : bat.status === "interpolated" ? "interpolated" : "not_observed",
      batterPose: Array.isArray(obj(poses.get(d.analysisFrame)).keypoints),
      sha256: createHash("sha256").update(data).digest("hex"), mimeType: png ? "image/png" : "image/jpeg",
      bytes: data.length, order: 0 });
    assets.set(d.name, file);
  }
  images.sort((a, b) => a.pts - b.pts || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  images.forEach((image, i) => { image.order = i; });
  // An event is citable only when its own still was supplied.
  const supportedEvents = events.filter(e => e.supported && images.some(i => i.kind === "phase_still" && i.eventId === e.id)).map(e => e.id);
  const pkg: V2EvidencePackage = {
    version: V2_EVIDENCE_PACKAGE_VERSION, clip: { videoClipId: input.videoClipId, sourceSha256: input.sourceSha256 },
    engine: { engine: metrics.engine as string, pipelineVersion: metrics.pipeline_version as string },
    identity: { batter: "selected", basis: "pose_and_bat" }, events, supportedEvents, images,
    excludedImages: excluded, statements: V2_STATEMENTS, approval: "not_coach_reviewed",
  };
  const problems = validateV2EvidencePackage(pkg);
  if (problems.length) return fail(`INVALID_PACKAGE:${problems.join(",")}`);
  const snapshot = JSON.parse(canonicalJson(pkg)) as V2EvidencePackage;
  return { ok: true, pkg: snapshot, assets, digest: createHash("sha256").update(canonicalJson(snapshot)).digest("hex") };
}

/** Structural checks plus a scan that rejects any absolute or file-URL path in the package. */
export function validateV2EvidencePackage(pkg: unknown): string[] {
  const problems = new Set<string>();
  const scan = (v: unknown): void => {
    if (typeof v === "string" && (path.posix.isAbsolute(v) || path.win32.isAbsolute(v) || /file:\/\/|[a-z]:[\\/]/i.test(v))) problems.add("ABSOLUTE_PATH");
    if (Array.isArray(v)) v.forEach(scan);
    else if (record(v)) Object.values(v).forEach(scan);
  };
  scan(pkg);
  const p = obj(pkg);
  if (p.version !== V2_EVIDENCE_PACKAGE_VERSION || p.approval !== "not_coach_reviewed") problems.add("PACKAGE_SCHEMA");
  const images = list(p.images).map(obj);
  let previous = -Infinity;
  images.forEach((image, i) => {
    if (image.order !== i || !finite(image.timeS) || !index(image.sourceFrame)) problems.add("IMAGE_SCHEMA");
    if (finite(image.timeS) && (image.timeS as number) < previous) problems.add("NON_CHRONOLOGICAL");
    if (finite(image.timeS)) previous = image.timeS as number;
    if (!["direct", "interpolated", "not_observed"].includes(image.batObservation as string)) problems.add("IMAGE_SCHEMA");
  });
  const supported = new Set(list(p.events).map(obj).filter(e => e.supported === true).map(e => e.id));
  if (list(p.supportedEvents).some(id => !supported.has(id))) problems.add("UNSUPPORTED_EVENT_LISTED");
  return [...problems].sort();
}

/** The evidence addendum appended to the unchanged production prompt (CLI analyzers' evidenceAddendum). */
export function renderV2Addendum(pkg: V2EvidencePackage): { version: typeof V2_RENDER_VERSION; text: string } {
  const label = (i: V2EvidenceImage) => [
    i.name, i.eventId ?? (i.kind === "swing_sequence" ? "sequence frame" : "unlabelled"),
    `source frame ${i.sourceFrame}`, `t=${i.timeS.toFixed(6)}s`,
    `bat: ${i.batObservation === "direct" ? "directly observed" : i.batObservation === "interpolated" ? "INTERPOLATED, not observed" : "not observed"}`,
    `batter pose: ${i.batterPose ? "observed" : "not observed"}`,
  ].join(" | ");
  const supported = pkg.events.filter(e => pkg.supportedEvents.includes(e.id));
  const text = `E. EXPERIMENTAL V2 EVENT EVIDENCE (${V2_RENDER_VERSION})
These rules add to section A and cannot relax it.
Images in source-time order (earliest first). Attachment order may follow file names; use this table for time order:
${pkg.images.map(i => `- ${label(i)}`).join("\n")}
Supported events you may cite (id -> phase still): ${supported.map(e => `${e.id} -> phase_${e.phase}`).join(", ") || "none"}.
Facts: ${pkg.statements.join("; ")}.
Rules for this run:
1. The phase_contact still shows the IMPACT ESTIMATE only. Never state or imply bat-ball contact, contact quality, ball flight, fair/foul or results.
2. No numbers: no speeds, angles, distances, durations, percentages or timings.
3. No hand-path, knob or bat-angle measurements.
4. Every strength and issue is either a direct observation of what an image shows or a qualified interpretation (hedged, "may"/"appears"); never a definite causal claim.
5. Every strength and every issue MUST also include "supportingEvents": [one or more ids from the supported list whose stills show it] and "claimType": "direct_observation" or "qualified_interpretation". A finding's phase must be the phase of one of its supporting events.
6. If an image does not clearly show what a finding needs, leave the finding out. Returning no finding is valid.`;
  return { version: V2_RENDER_VERSION, text };
}
