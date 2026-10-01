import test from "node:test";
import assert from "node:assert/strict";
import { insetCss, readSubjectBox, unionBox, viewRegion } from "./subjectZoom.js";

test("readSubjectBox accepts only a well-formed normalized box", () => {
  assert.deepEqual(readSubjectBox({ subject_box: { x: 0.1, y: 0.2, w: 0.1, h: 0.3, method: "m" } }), { x: 0.1, y: 0.2, w: 0.1, h: 0.3 });
  for (const detail of [null, {}, { subject_box: { x: 0.1, y: 0.2, w: 0, h: 0.3 } }, { subject_box: { x: 0.95, y: 0, w: 0.2, h: 0.3 } }, { subject_box: { x: "0.1", y: 0, w: 0.1, h: 0.1 } }]) {
    assert.equal(readSubjectBox(detail), null, JSON.stringify(detail));
  }
});

test("unionBox covers every phase box and ignores missing ones", () => {
  const u = unionBox([{ x: 0.1, y: 0.2, w: 0.1, h: 0.2 }, null, { x: 0.15, y: 0.1, w: 0.2, h: 0.2 }]);
  assert.deepEqual([u.x, u.y, u.w, u.h].map((v) => Math.round(v * 1e6) / 1e6), [0.1, 0.1, 0.25, 0.3]);
  assert.equal(unionBox([null, undefined]), null);
});

test("viewRegion widens a tall batter box to 3:4 around its centre", () => {
  // 1920x1080 frame; box 96px wide x 324px tall centred at (240, 324).
  const r = viewRegion({ x: 0.1, y: 0.15, w: 0.05, h: 0.3 }, 1920, 1080);
  assert.equal(r.aspect, 0.75);
  // 3:4 width is 243px centred at x=240: left 118.5px (6.17%), right edge 361.5px.
  assert.deepEqual(r.inset, { top: 15, right: 81.17, bottom: 55, left: 6.17 });
  assert.equal(insetCss(r.inset), "inset(15% 81.17% 55% 6.17%)");
});

test("viewRegion stays inside the frame near an edge and grows a very wide box's height", () => {
  const edge = viewRegion({ x: 0, y: 0.7, w: 0.05, h: 0.3 }, 1920, 1080);
  assert.equal(edge.inset.left, 0);
  assert.equal(edge.inset.bottom, 0);
  const wide = viewRegion({ x: 0.1, y: 0.4, w: 0.8, h: 0.1 }, 1920, 1080);
  assert.equal(wide.aspect, 1.778);
});

test("viewRegion fails closed without a box or video size", () => {
  assert.equal(viewRegion(null, 1920, 1080), null);
  assert.equal(viewRegion({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, 0, 0), null);
});
