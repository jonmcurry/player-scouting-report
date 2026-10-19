import test from "node:test";
import assert from "node:assert/strict";
import { heartbeatUpdate, startClaimHeartbeat, ClaimLostError } from "./claimHeartbeat.js";

test("CAS preserves exact timestamp text and processing predicate", () => {
  const expected = "2026-01-01T00:00:00.123456+00:00";
  assert.deepEqual(heartbeatUpdate("clip", expected, "new"), {
    values: { claimed_at: "new" }, where: { id: "clip", status: "processing", claimed_at: expected },
  });
  assert.throws(() => heartbeatUpdate("clip", "", "new"));
});

test("lost claim aborts and forbids all later writes, including failure writes", async t => {
  const expected: string[] = [];
  const claim = startClaimHeartbeat("original", 100000, async value => {
    expected.push(value); return expected.length === 1 ? "stored" : null;
  });
  t.after(claim.stop);
  await claim.tick();
  await claim.tick();
  assert.deepEqual(expected, ["original", "stored"]);
  assert.equal(claim.signal.aborted, true);
  let writes = 0;
  await assert.rejects(claim.write(async () => ++writes), ClaimLostError);
  await assert.rejects(claim.finish(async () => ++writes), ClaimLostError);
  assert.equal(writes, 0);
});

test("heartbeat errors retry with same token; finish serializes with heartbeat", async t => {
  const tokens: string[] = [];
  const errors: unknown[] = [];
  const claim = startClaimHeartbeat("original", 100000, async value => {
    tokens.push(value);
    if (tokens.length === 1) throw new Error("temporary");
    return "renewed";
  }, e => errors.push(e));
  t.after(claim.stop);
  await claim.tick();
  await claim.tick();
  await claim.finish(async () => {});
  await claim.tick();
  assert.deepEqual(tokens, ["original", "original"]);
  assert.equal(errors.length, 1);
  assert.equal(claim.lost, false);
});

test("queued writes wait for in-flight heartbeat loss", async t => {
  let resolve!: (result: null) => void;
  const claim = startClaimHeartbeat("original", 100000, () => new Promise(r => { resolve = r; }));
  t.after(claim.stop);
  const beat = claim.tick();
  await Promise.resolve();
  const write = claim.write(async () => assert.fail("must never write"));
  resolve(null);
  await beat;
  await assert.rejects(write, ClaimLostError);
});
