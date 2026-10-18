import { PIPELINE_VERSION } from "../reconstruction/types.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  assertEnforceableTuple, BASELINE_ENGINE, EVIDENCE_REGISTRY, engineCodeForPipelineVersion,
  ENGINE_RUNTIME_EVIDENCE_TUPLE, INITIAL_EVIDENCE_TUPLE, isEvidenceTuple, LEGACY_PIPELINE_VERSION, resolveTuple,
  type ActiveTuple, type EvidenceTuple,
} from "./evidenceRegistry.ts";

// Synthetic authorization records only. Never inserted into the runtime catalog.
const approved: EvidenceTuple = { ...INITIAL_EVIDENCE_TUPLE,
  claimsVersion: "claims-1.0.0", reliabilityProfileVersion: "reliability-synthetic-1" };
const enforced: ActiveTuple = { ...approved, status: "enforced", reliabilityReference: "synthetic-profile-record",
  d7ApprovalReference: "synthetic-d7", enforcementApprovalReference: "synthetic-s1-12",
  approvedBy: "synthetic-reviewer", approvedAt: "2026-10-13T00:00:00.000Z" };

test("initial catalog is immutable, shadow-only, uncalibrated and unapproved", () => {
  assert.equal(EVIDENCE_REGISTRY.length, 2);
  assert.equal(EVIDENCE_REGISTRY[0]!.status, "shadow");
  assert.equal(EVIDENCE_REGISTRY[0]!.reliabilityProfileVersion, null);
  assert.equal(EVIDENCE_REGISTRY[0]!.approvedBy, undefined);
  assert.equal(EVIDENCE_REGISTRY[0]!.d7ApprovalReference, undefined);
  assert.ok(Object.isFrozen(EVIDENCE_REGISTRY) && Object.isFrozen(EVIDENCE_REGISTRY[0]));
  assert.throws(() => assertEnforceableTuple(INITIAL_EVIDENCE_TUPLE, BASELINE_ENGINE));
});

test("runtime capture is a distinct immutable shadow identity with unique resolution", () => {
  assert.deepEqual(EVIDENCE_REGISTRY[1], { ...ENGINE_RUNTIME_EVIDENCE_TUPLE, status: "shadow" });
  assert.deepEqual(Object.keys(INITIAL_EVIDENCE_TUPLE).filter(key =>
    INITIAL_EVIDENCE_TUPLE[key as keyof EvidenceTuple] !== ENGINE_RUNTIME_EVIDENCE_TUPLE[key as keyof EvidenceTuple]),
  ["environmentVersion"]);
  for (const [index, tuple] of [INITIAL_EVIDENCE_TUPLE, ENGINE_RUNTIME_EVIDENCE_TUPLE].entries()) {
    assert.ok(Object.isFrozen(tuple));
    assert.ok(Object.isFrozen(EVIDENCE_REGISTRY[index]));
    assert.deepEqual(resolveTuple(tuple), EVIDENCE_REGISTRY[index]);
    assert.throws(() => assertEnforceableTuple(tuple, BASELINE_ENGINE));
    assert.equal(resolveTuple(tuple, [...EVIDENCE_REGISTRY, EVIDENCE_REGISTRY[index]]), null);
  }
  assert.equal(resolveTuple({ ...ENGINE_RUNTIME_EVIDENCE_TUPLE, environmentVersion: "env-000000000000" }), null);
});

test("exact resolution is deterministic and independent of key order", () => {
  const reversed = Object.fromEntries(Object.entries(INITIAL_EVIDENCE_TUPLE).reverse());
  assert.deepEqual(resolveTuple(reversed), EVIDENCE_REGISTRY[0]);
  assert.deepEqual(resolveTuple(reversed), resolveTuple(INITIAL_EVIDENCE_TUPLE));
  assert.ok(Object.isFrozen(resolveTuple(reversed)));
});

for (const key of Object.keys(INITIAL_EVIDENCE_TUPLE)) {
  test(`tuple requires exact ${key}`, () => {
    assert.equal(resolveTuple({ ...INITIAL_EVIDENCE_TUPLE, [key]: "unknown-9" }), null);
    const missing = { ...INITIAL_EVIDENCE_TUPLE } as Record<string, unknown>;
    delete missing[key];
    assert.equal(resolveTuple(missing), null);
    assert.equal(resolveTuple({ ...INITIAL_EVIDENCE_TUPLE, [key]: undefined }), null);
  });
}

test("malformed tuples/catalogs, duplicate and retired records cannot resolve", () => {
  for (const value of [null, [], "tuple", {}, { ...INITIAL_EVIDENCE_TUPLE, extra: true },
    { ...INITIAL_EVIDENCE_TUPLE, environmentVersion: " " },
    Object.create(INITIAL_EVIDENCE_TUPLE)]) {
    assert.equal(isEvidenceTuple(value), false);
    assert.equal(resolveTuple(value), null);
  }
  for (const registry of [[], [null], [enforced, enforced], [{ ...enforced, status: "retired" }],
    [{ ...enforced, status: "ENFORCED" }], [{ ...enforced, status: ["enforced"] }],
    [{ ...enforced, status: { toString: () => "shadow" } }], [{ ...enforced, extra: "ignored?" }],
    [{ ...enforced, approvedAt: "2026-02-30T00:00:00.000Z" }]]) {
    assert.equal(resolveTuple(approved, registry), null);
    assert.throws(() => assertEnforceableTuple(approved, BASELINE_ENGINE, registry));
  }
});

test("synthetic complete enforced record passes only its exact engine/tuple", () => {
  assert.deepEqual(assertEnforceableTuple(approved, BASELINE_ENGINE, [enforced]), enforced);
  assert.throws(() => assertEnforceableTuple(approved, "engine-unknown", [enforced]));
  assert.throws(() => assertEnforceableTuple(INITIAL_EVIDENCE_TUPLE, BASELINE_ENGINE, [enforced]));
  for (const status of ["shadow", "enforce_candidate", "retired"]) {
    assert.throws(() => assertEnforceableTuple(approved, BASELINE_ENGINE, [{ ...enforced, status }]));
  }
});

for (const field of ["reliabilityReference", "d7ApprovalReference", "enforcementApprovalReference", "approvedBy", "approvedAt"]) {
  test(`enforcement requires valid ${field}`, () => {
    for (const value of [undefined, null, "", " ", false]) {
      assert.throws(() => assertEnforceableTuple(approved, BASELINE_ENGINE, [{ ...enforced, [field]: value }]));
    }
    const missing = { ...enforced } as Record<string, unknown>;
    delete missing[field];
    assert.throws(() => assertEnforceableTuple(approved, BASELINE_ENGINE, [missing]));
  });
}

test("no profile and proposed claims stay non-enforceable even with synthetic approvals", () => {
  for (const tuple of [{ ...approved, reliabilityProfileVersion: null },
    { ...approved, claimsVersion: INITIAL_EVIDENCE_TUPLE.claimsVersion }]) {
    assert.throws(() => assertEnforceableTuple(tuple, BASELINE_ENGINE, [{ ...enforced, ...tuple }]));
  }
});

test("legacy stamp maps only engine identity, never manufactures a complete tuple", () => {
  assert.equal(engineCodeForPipelineVersion(LEGACY_PIPELINE_VERSION), BASELINE_ENGINE);
  assert.equal(resolveTuple(LEGACY_PIPELINE_VERSION), null);
  for (const unknown of [undefined, null, "", "pose3d-live-1.0.1", PIPELINE_VERSION, BASELINE_ENGINE]) {
    assert.equal(engineCodeForPipelineVersion(unknown), null);
  }
});

test("compatibility catalog matches existing version owners without importing production", () => {
  const baseline = readFileSync("docs/architecture/ENGINE_BASELINE.md", "utf8");
  const policy = JSON.parse(baseline.match(/```json\s*([\s\S]*?)```/)![1]!);
  assert.equal(INITIAL_EVIDENCE_TUPLE.engineCodeVersion, policy.engineCodeVersion);
  assert.equal(INITIAL_EVIDENCE_TUPLE.instrumentationVersion, policy.instrumentationVersion);
  assert.equal(INITIAL_EVIDENCE_TUPLE.environmentVersion, policy.environmentVersion);
  assert.equal(LEGACY_PIPELINE_VERSION, policy.pipelineVersion);
  const pipeline = readFileSync("scripts/pose3d/run_pipeline.py", "utf8");
  assert.ok(pipeline.includes(`PIPELINE_VERSION = "${LEGACY_PIPELINE_VERSION}"`));
});
