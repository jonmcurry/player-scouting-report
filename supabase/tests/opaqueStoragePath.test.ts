import { test } from "node:test";
import assert from "node:assert/strict";
import { opaqueRawObject } from "../functions/_shared/opaqueStoragePath.ts";

const entry = "4ebf0c49-75ef-4f21-90a2-5a4b66d183fd";
const clip = "3d71b0e6-d326-4853-80e9-1a881a8e3537";
const object = `${entry}/raw/${clip}.mp4`;

test("only an opaque object belonging to this entry and clip can get a signed URL", () => {
  assert.equal(opaqueRawObject(`gs://private/${object}`, "private", entry, clip), object);
  assert.equal(opaqueRawObject(`gs://private/${object}`, "private", entry, "old-file-name", clip), object);
  assert.equal(opaqueRawObject(`gs://private/team/player/raw/${clip}.mp4`, "private", entry, clip), null);
  assert.equal(opaqueRawObject(`gs://private/${entry}/raw/${clip}/other.mp4`, "private", entry, clip), null);
  assert.equal(opaqueRawObject(`gs://other/${object}`, "private", entry, clip), null);
  assert.equal(opaqueRawObject(`gs://private/${entry}/raw/${clip}.mp4`, "private", entry, "wrong"), null);
});
