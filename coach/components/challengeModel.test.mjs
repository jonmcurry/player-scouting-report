import test from "node:test";
import assert from "node:assert/strict";
import { evaluateChallenge } from "./challengeModel.js";

const base = () => ({ validated: true, kind: "repeatability", environment: "front_toss",
  captureProfiles: ["open_side_practice"], tasks: [{ key: "middle", label: "Middle", minimum: 2 }],
  slots: [1, 2].map((number) => ({ number, task: "middle", state: "recorded", actualContext: "middle",
    actualEnvironment: "front_toss", readable: true, repUsable: true, repMatchesSession: true,
    captureProfile: "open_side_practice", captureSupported: true, observation: "consistent" })) });

test("a validated same-task protocol needs every eligible recorded rep", () => {
  const protocol = base();
  assert.equal(evaluateChallenge(protocol).state, "ready");
  protocol.slots[0].state = "missed";
  assert.equal(evaluateChallenge(protocol).state, "incomplete");
  protocol.slots[0].state = "recorded";
  protocol.slots[0].readable = false;
  assert.equal(evaluateChallenge(protocol).state, "insufficient");
  protocol.slots[0].readable = true;
  protocol.slots[0].captureSupported = false;
  assert.equal(evaluateChallenge(protocol).state, "insufficient");
  protocol.slots[0].captureSupported = true;
  protocol.slots[0].repMatchesSession = false;
  assert.equal(evaluateChallenge(protocol).state, "insufficient");
  protocol.slots[0].repMatchesSession = true;
  protocol.slots[0].captureProfile = "game_backstop";
  assert.equal(evaluateChallenge(protocol).state, "insufficient");
});

test("pilot protocol never publishes a result, and change never means improvement", () => {
  const protocol = base();
  protocol.validated = false;
  protocol.slots[0].observation = "changed";
  assert.equal(evaluateChallenge(protocol).state, "unvalidated");
  assert.equal(evaluateChallenge(protocol).changed, false);
  protocol.validated = true;
  assert.equal(evaluateChallenge(protocol).changed, true);
  assert.deepEqual(evaluateChallenge(protocol).observations, { consistent: 1, changed: 1, unclear: 0 });
  assert.equal(evaluateChallenge(protocol).improved, false);
});

test("task context, environment, and every task minimum are required", () => {
  const protocol = base();
  protocol.slots[0].actualContext = "high";
  assert.equal(evaluateChallenge(protocol).state, "insufficient");
  protocol.slots[0].actualContext = "middle";
  protocol.slots[0].actualEnvironment = "tee";
  assert.equal(evaluateChallenge(protocol).state, "insufficient");
  protocol.slots[0].actualEnvironment = "front_toss";
  protocol.tasks.push({ key: "low", label: "Low", minimum: 2 });
  assert.equal(evaluateChallenge(protocol).state, "insufficient");
});

test("a challenge loses its result if its same-task prerequisite becomes stale", () => {
  const protocol = base();
  protocol.kind = "challenge";
  protocol.repeatabilityReady = false;
  assert.equal(evaluateChallenge(protocol).state, "prerequisite_missing");
  protocol.repeatabilityReady = true;
  assert.equal(evaluateChallenge(protocol).state, "ready");
});
