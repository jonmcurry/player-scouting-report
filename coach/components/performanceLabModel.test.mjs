import test from "node:test";
import assert from "node:assert/strict";
import { labDistributions } from "./performanceLabModel.js";

test("lab distributions need one exact mapping version and minimum sample", () => {
  const imports = [{ id: "i", provider: "Pilot", deviceModel: "A", firmware: "1", importedAt: "2026-10-11" }];
  const reading = (n, mappingId = "v1") => ({ importId: "i", normalized: [{ mappingId,
    mappingVersion: mappingId, definition: "External speed", definitionVersion: "1.0.0",
    unit: "mph", minimumSample: 5, value: n }] });
  const report = { imports, readings: [1, 2, 3, 4, 5].map((n) => reading(n)) };
  assert.equal(labDistributions(report)[0].stats.median, 3);
  report.readings[4] = reading(5, "v2");
  assert.equal(labDistributions(report).every((group) => group.stats === null), true);
  assert.deepEqual(labDistributions({ ...report, truncated: true }), []);
});

test("a missing aggregate threshold never creates a distribution", () => {
  const report = { imports: [{ id: "i", provider: "P", deviceModel: "M", firmware: "1", importedAt: "2026-10-11" }],
    readings: Array.from({ length: 8 }, () => ({ importId: "i", normalized: [{ mappingId: "m",
      mappingVersion: "1.0.0", definition: "X", definitionVersion: "1.0.0",
      unit: "unit", minimumSample: null, value: 7 }] })) };
  assert.equal(labDistributions(report)[0].stats, null);
});
