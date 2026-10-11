import assert from "node:assert/strict";
import { test } from "node:test";
import { projectEvidence, type EvidenceReadRow, type SourceClass } from "./evidence.js";

const base: EvidenceReadRow = {
  packageId: "private-package", playerId: "private-player", clipId: "private-clip",
  resultKey: "plant_visible", definitionSlug: "plant_visible", definitionVersion: "0.1.0",
  plainDefinition: "Visible front-foot plant", status: "validated_internal",
  sourceClass: "video_observed", value: true, uncertainty: { status: "frame_bounded" },
  limitation: "Occluded feet are unavailable", provider: null,
  versions: { pipeline: "p1", detector: "d1", measurement: "m1", methodology: "k1", prompt: "r1", model: "a1" },
  items: [{ kind: "frame", role: "included", frameStart: 42, frameEnd: 43, fps: 60, uncertaintyFrames: 1,
    storagePath: "secret/path" }],
  storagePath: "secret/path", teamName: "Secret Team", internalPrompt: "secret prompt",
};

test("all five source classes retain a distinct provenance label", () => {
  const examples: Array<[SourceClass, string]> = [
    ["video_observed", "Observed in video"],
    ["video_estimated", "Estimated from video"],
    ["comparable_video", "Calculated from comparable video"],
    ["external_device", "Measured by radar"],
    ["coach_entered", "Entered by coach/user"],
  ];
  for (const [sourceClass, expected] of examples) {
    const result = projectEvidence({ ...base, sourceClass, provider: "radar" }, "coach");
    assert.equal(result?.source, expected);
    assert.ok(result?.definition.version);
  }
});

test("experimental, retired, missing evidence, and family views fail closed", () => {
  assert.equal(projectEvidence({ ...base, status: "experimental" }, "coach"), null);
  assert.equal(projectEvidence({ ...base, status: "retired" }, "coach"), null);
  assert.equal(projectEvidence({ ...base, items: [] }, "coach"), null);
  assert.equal(projectEvidence(base, "family"), null);
  assert.equal(projectEvidence({ ...base, sourceClass: "external_device", provider: null }, "coach"), null);
});

test("projection excludes player identity, storage paths, hashes, and internal prompts", () => {
  const result = projectEvidence(base, "coach");
  assert.ok(result);
  const serialized = JSON.stringify(result);
  for (const secret of ["private-player", "private-clip", "private-package", "secret/path", "Secret Team", "secret prompt"])
    assert.equal(serialized.includes(secret), false);
  assert.equal(result.evidence[0]?.frameStart, 42);
});

test("exclusion reasons are translated without private IDs", () => {
  const result = projectEvidence({ ...base, items: [
    base.items[0]!, { kind: "aggregate_member", role: "excluded", exclusionReason: "incompatible_capture", attemptId: "private-attempt" },
  ] }, "performance_lab");
  assert.equal(result?.evidence[1]?.exclusion, "Different camera setup");
  assert.equal(JSON.stringify(result).includes("private-attempt"), false);
});
