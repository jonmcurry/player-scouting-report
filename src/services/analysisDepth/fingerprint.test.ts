import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMembers, distribution, exclusion, trend, type ComparisonDefinition,
  type ComparisonInput } from "./fingerprint.ts";

const definition: ComparisonDefinition = { id: "def-v1", version: "1.0.0",
  status: "validated_internal", sports: ["softball"], intents: ["conventional_full"],
  profiles: ["game_backstop"], aggregateMinSample: 5, trendMinSample: 10,
  trendThreshold: null, requiredPhases: [] };
const reference: ComparisonInput = { attemptId: "a0", clipId: "c0", playerId: "p1",
  date: "2026-10-01", sport: "softball", intent: "conventional_full", environment: "game",
  sessionType: "game", profile: "game_backstop", profileVersion: "1.0.0", orientation: "portrait",
  captureState: "supported", assessmentStage: "full", qualityClear: true,
  visiblePhases: [], resultDefinitionId: "def-v1", sourcePackageId: "e0", value: 1,
  visible: true, sourceRevision: "r0" };
const attempt = (n: number): ComparisonInput => ({ ...reference, attemptId: `a${n}`, clipId: `c${n}`,
  sourcePackageId: `e${n}`, date: `2026-10-${String(n + 1).padStart(2, "0")}`, value: n });

test("compatibility rejects athlete, sport, intent, environment, camera, and unsupported evidence", () => {
  assert.equal(exclusion(reference, { ...attempt(1), playerId: "p2" }, definition), "wrong_athlete");
  assert.equal(exclusion(reference, { ...attempt(1), sport: "baseball" }, definition), "sport_mismatch");
  assert.equal(exclusion(reference, { ...attempt(1), intent: "slap" }, definition), "intent_mismatch");
  assert.equal(exclusion(reference, { ...attempt(1), sessionType: "practice" }, definition), "environment_mismatch");
  assert.equal(exclusion(reference, { ...attempt(1), profileVersion: "2.0.0" }, definition), "incompatible_capture");
  assert.equal(exclusion(reference, { ...attempt(1), captureState: "needs_recheck" }, definition), "incompatible_capture");
  assert.equal(exclusion(reference, { ...attempt(1), visible: false }, definition), "insufficient_quality");
  assert.equal(exclusion(reference, attempt(1), { ...definition, requiredPhases: ["contact_estimate"] }), "insufficient_quality");
  assert.equal(exclusion(reference, { ...attempt(1), visiblePhases: ["contact_estimate"] },
    { ...definition, requiredPhases: ["contact_estimate"] }), null);
  assert.equal(exclusion(reference, { ...attempt(1), qualityClear: false }, definition), "insufficient_quality");
  assert.equal(exclusion(reference, { ...attempt(1), resultDefinitionId: "def-v2" }, definition), "definition_version_mismatch");
  assert.equal(exclusion(reference, { ...attempt(1), value: null }, definition), "missing_result");
  assert.equal(exclusion(reference, attempt(1), definition, true), "coach_excluded");
});

test("five eligible attempts yield a descriptive distribution; omissions and small samples do not", () => {
  const members = buildMembers(reference, Array.from({ length: 5 }, (_, index) => attempt(index + 1)), definition);
  assert.deepEqual(distribution(members, definition), { count: 5, excludedCount: 0,
    from: "2026-10-02", through: "2026-10-06", median: 3, q1: 2, q3: 4, iqr: 2 });
  const narrowed = buildMembers(reference, Array.from({ length: 5 }, (_, index) => attempt(index + 1)),
    definition, new Set(["a5"]));
  assert.equal(distribution(narrowed, definition), null);
  assert.equal(distribution(members, { ...definition, status: "experimental" }), null);
  assert.equal(distribution(members, { ...definition, aggregateMinSample: null }), null);
  assert.equal(distribution([], definition), null);
});

test("trend stays unavailable without two compatible adequate windows and an approved threshold", () => {
  const prior = distribution(buildMembers(reference, Array.from({ length: 10 }, (_, i) => attempt(i + 1)),
    definition), definition)!;
  const later = { ...prior, median: prior.median + 2 };
  assert.equal(trend(prior, later, "game:one", "game:one", definition), null);
  assert.equal(trend(prior, later, "game:one", "practice:one",
    { ...definition, trendThreshold: 1 }), null);
  assert.equal(trend({ ...prior, count: 9 }, later, "game:one", "game:one",
    { ...definition, trendThreshold: 1 }), null);
  assert.equal(trend(prior, later, "game:one", "game:one",
    { ...definition, trendThreshold: 1 }), "higher");
});
