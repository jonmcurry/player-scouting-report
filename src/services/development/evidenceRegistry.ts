import { GATE_VERSION, PROPOSED_CLAIMS_VERSION } from "./evidence/version.ts";

// Mirrors the protected ENGINE_BASELINE.md registration; drift is tested.
// This is a compatibility catalog, not a second engine/environment version owner.
export const BASELINE_ENGINE = "engine-baseline-1.0.0";
export const LEGACY_PIPELINE_VERSION = "pose3d-live-1.0.0";

export interface EvidenceTuple {
  readonly engineCodeVersion: string;
  readonly instrumentationVersion: string;
  readonly environmentVersion: string;
  readonly gateVersion: string;
  readonly claimsVersion: string;
  readonly reliabilityProfileVersion: string | null;
}

export type RegistryStatus = "shadow" | "enforce_candidate" | "enforced" | "retired";
export interface ActiveTuple extends EvidenceTuple {
  readonly status: RegistryStatus;
  // Opaque reviewed-record references, never credentials, names or private paths.
  readonly reliabilityReference?: string;
  readonly d7ApprovalReference?: string;
  readonly enforcementApprovalReference?: string;
  readonly approvedBy?: string; // opaque product-owner reviewer ID
  readonly approvedAt?: string; // UTC ISO instant
}

export const INITIAL_EVIDENCE_TUPLE: Readonly<EvidenceTuple> = Object.freeze({
  engineCodeVersion: BASELINE_ENGINE,
  instrumentationVersion: "inst-1",
  environmentVersion: "env-f4ad5b330d0c",
  gateVersion: GATE_VERSION,
  claimsVersion: PROPOSED_CLAIMS_VERSION,
  reliabilityProfileVersion: null,
});

// Engine runtime boundary capture: ultralytics import sets OMP_NUM_THREADS=1,
// torch uses 1 CPU thread. See docs/evaluation/environment-provenance.md.
// A distinct identity, not an alias of the initial capture.
export const ENGINE_RUNTIME_EVIDENCE_TUPLE: Readonly<EvidenceTuple> = Object.freeze({
  ...INITIAL_EVIDENCE_TUPLE,
  environmentVersion: "env-9a6a8510dec8",
});

export const EVIDENCE_REGISTRY: readonly Readonly<ActiveTuple>[] = Object.freeze([
  Object.freeze({ ...INITIAL_EVIDENCE_TUPLE, status: "shadow" as const }),
  Object.freeze({ ...ENGINE_RUNTIME_EVIDENCE_TUPLE, status: "shadow" as const }),
]);

const tupleKeys = ["engineCodeVersion", "instrumentationVersion", "environmentVersion",
  "gateVersion", "claimsVersion", "reliabilityProfileVersion"] as const;
const entryKeys = [...tupleKeys, "status", "reliabilityReference", "d7ApprovalReference",
  "enforcementApprovalReference", "approvedBy", "approvedAt"];
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function tupleFields(value: Record<string, unknown>): boolean {
  return tupleKeys.every(key => Object.hasOwn(value, key)
    && (key === "reliabilityProfileVersion" && value[key] === null || identifier(value[key])));
}

export function isEvidenceTuple(value: unknown): value is EvidenceTuple {
  return record(value) && Object.keys(value).length === tupleKeys.length && tupleFields(value);
}

function isEntry(value: unknown): value is ActiveTuple {
  if (!record(value) || !tupleFields(value) || Object.keys(value).some(key => !entryKeys.includes(key))) return false;
  if (!Object.hasOwn(value, "status") || typeof value.status !== "string"
    || !["shadow", "enforce_candidate", "enforced", "retired"].includes(value.status)) return false;
  for (const key of ["reliabilityReference", "d7ApprovalReference", "enforcementApprovalReference", "approvedBy"]) {
    if (Object.hasOwn(value, key) && !identifier(value[key])) return false;
  }
  if (Object.hasOwn(value, "approvedAt")) {
    if (typeof value.approvedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.approvedAt)) return false;
    const timestamp = Date.parse(value.approvedAt);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value.approvedAt) return false;
  }
  return true;
}

/** Exact, unique match only. Malformed catalogs and retired matches fail closed.
 * Registry injection supports offline validation/tests, not runtime env overrides.
 */
export function resolveTuple(tuple: unknown, registry: readonly unknown[] = EVIDENCE_REGISTRY): Readonly<ActiveTuple> | null {
  if (!isEvidenceTuple(tuple) || !Array.isArray(registry) || !registry.every(isEntry)) return null;
  const matches = (registry as ActiveTuple[]).filter(entry => tupleKeys.every(key => entry[key] === tuple[key]));
  if (matches.length !== 1 || matches[0]!.status === "retired") return null;
  return Object.freeze({ ...matches[0]! });
}

/** No inference of instrumentation/environment/reliability from an old stamp. */
export function engineCodeForPipelineVersion(pipelineVersion: unknown): string | null {
  return pipelineVersion === LEGACY_PIPELINE_VERSION ? BASELINE_ENGINE : null;
}

/** Structural authorization only: record truth/calibration is a human review gate.
 * This does not compute evidence eligibility or certify a reliability profile.
 */
export function assertEnforceableTuple(tuple: unknown, engine: string,
  registry: readonly unknown[] = EVIDENCE_REGISTRY): Readonly<ActiveTuple> {
  const entry = resolveTuple(tuple, registry);
  if (!entry || entry.engineCodeVersion !== engine || entry.status !== "enforced") {
    throw new Error("Evidence enforcement requires an exact compatible enforced tuple");
  }
  if (entry.claimsVersion.endsWith("-proposed") || !entry.reliabilityProfileVersion
    || !entry.reliabilityReference || !entry.d7ApprovalReference
    || !entry.enforcementApprovalReference || !entry.approvedBy || !entry.approvedAt) {
    throw new Error("Evidence enforcement requires reliability, approved claims and D7/S1-12 reviewer records");
  }
  return entry;
}
