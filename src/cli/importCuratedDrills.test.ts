import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { candidatePayload, generateDrillSql, applyCandidates } from "./importCuratedDrills.js";
import { loadCandidateDrills } from "../services/development/drillCandidateParser.js";
import { requirePublicKey } from "./reviewDrill.js";
import type { SupabaseClient } from "@supabase/supabase-js";

// Git may check the SQL out with CRLF on Windows. Preserve every other
// character: this is generated-content equality, not a raw-file checksum.
function assertGeneratedSqlEqual(generated: string, checkedIn: string) {
  assert.equal(generated.replaceAll("\r\n", "\n"), checkedIn.replaceAll("\r\n", "\n"));
}

test("migration matches the generated draft-only import for all 90 candidates after newline normalization", () => {
  const drills = loadCandidateDrills();
  assert.equal(drills.length, 90);
  assertGeneratedSqlEqual(generateDrillSql(drills), readFileSync("supabase/migrations/00063_drill_library_candidates.sql", "utf8"));
  for (const d of drills) {
    const p = candidatePayload(d);
    assert.equal(p.curation_status, "draft"); assert.equal(p.curated_by, null); assert.equal(p.curated_at, null);
  }
});

for (const eol of ["\n", "\r\n"]) {
  test(`generated migration equality accepts ${eol === "\n" ? "LF" : "CRLF"} checkout lines`, () => {
    const generated = generateDrillSql(loadCandidateDrills());
    assertGeneratedSqlEqual(generated, generated.replaceAll("\n", eol));
  });
}

test("newline normalization still rejects SQL/security content and other whitespace changes", () => {
  const generated = generateDrillSql(loadCandidateDrills());
  for (const changed of [
    generated.replace("E'draft'", "E'approved'"),
    generated.replace("INSERT INTO", "DELETE FROM"),
    generated + " ",
    generated.replace("\n", "\r"),
  ]) {
    assert.notEqual(changed, generated);
    assert.throws(() => assertGeneratedSqlEqual(generated, changed), assert.AssertionError);
  }
});
test("SQL escapes content including quotes and backslashes", () => {
  const d = { ...loadCandidateDrills()[0]!, name: "It's \\ safe", targetTags: ["a'b", "a\\b"] };
  assert.ok(generateDrillSql([d]).includes("E'It''s \\\\ safe'"));
  assert.ok(generateDrillSql([d]).includes("ARRAY[E'a''b', E'a\\\\b']"));
});
test("apply preserves reviewed rows, retries insert races only with a draft predicate, and propagates lookup failures", async () => {
  for (const scenario of ["existing", "new", "race", "lookup-failure"]) {
    const calls: unknown[][] = [];
    const db = { schema(schema: string) {
      const query: any = {
        from() { return query; }, select() { return query; }, is() { return query; },
        eq(key: string, value: unknown) { calls.push([schema, key, value]); return query; },
        maybeSingle: async () => ({ data: scenario === "existing" ? { id: "id" } : null, error: scenario === "lookup-failure" ? new Error("lookup failed") : null }),
        insert: async (payload: any) => { calls.push([schema, "insert", payload]); return { error: scenario === "race" ? { code: "23505" } : null }; },
        update(payload: any) { calls.push([schema, "update", payload]); return query; },
        then(resolve: (value: unknown) => void) { resolve({ error: null }); },
      }; return query;
    } } as unknown as SupabaseClient;
    if (scenario === "lookup-failure") { await assert.rejects(applyCandidates(db, [loadCandidateDrills()[0]!]), /lookup failed/); continue; }
    await applyCandidates(db, [loadCandidateDrills()[0]!]);
    for (const schema of ["public", "demo"]) {
      if (scenario !== "new") {
        assert.ok(calls.some(c => c[0] === schema && c[1] === "curation_status" && c[2] === "draft"));
        const payload = calls.find(c => c[0] === schema && c[1] === "update")![2] as object;
        assert.ok(!("curated_by" in payload)); assert.ok(!("curation_status" in payload));
      }
    }
  }
});
test("review CLI accepts only public client keys", () => {
  const jwt = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  requirePublicKey(jwt("anon")); requirePublicKey("sb_publishable_test");
  for (const key of [jwt("service_role"), jwt("authenticated"), "sb_secret_test", "junk"]) assert.throws(() => requirePublicKey(key));
});
