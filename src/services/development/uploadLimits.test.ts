import test from "node:test";
import assert from "node:assert/strict";
import { MAX_UPLOAD_SECONDS, uploadDurationRejection } from "./uploadLimits.js";

test("the worker accepts the three-minute boundary and rejects anything longer", () => {
  assert.equal(MAX_UPLOAD_SECONDS, 180);
  assert.equal(uploadDurationRejection(180), null);
  assert.match(uploadDurationRejection(180.001)!, /longer than the 3-minute upload limit/);
});

test("missing or invalid duration metadata fails instead of bypassing the limit", () => {
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => uploadDurationRejection(value), /duration/);
  }
});
