import test from "node:test";
import assert from "node:assert/strict";
import { batterInBox, normalizeBox, scaleBox, subjectBoxAt, subjectBoxOverFrames, type BatFrame, type Pose2dFrame } from "./subjectBox.js";

// 17 keypoints of a 100px-tall standing figure centred at x=500, top at y=400.
function figure(frame: number, conf = 0.9, dx = 0): Pose2dFrame {
  const kps: [number, number, number][] = [];
  for (let i = 0; i < 17; i++) kps.push([480 + dx + (i % 5) * 10, 400 + (i / 16) * 100, conf]);
  return { frame, keypoints: kps };
}

test("box pads the keypoint extent by 0.35 x body height and widens to 0.9 x body height", () => {
  const box = subjectBoxAt([figure(10)], [], 10, 1920, 1080)!;
  // keypoints span x 480-520, y 400-500 (body height 100): pad 35 -> x 445-555 (110 wide, above the 90 minimum).
  assert.deepEqual(box, { x0: 445, y0: 365, x1: 555, y1: 535 });
});

test("a narrow figure is widened around its centre to the minimum width", () => {
  const narrow: Pose2dFrame = { frame: 1, keypoints: Array.from({ length: 17 }, (_, i) => [500, 400 + (i / 16) * 100, 0.9] as [number, number, number]) };
  const box = subjectBoxAt([narrow], [], 1, 1920, 1080)!;
  assert.equal(box.x1 - box.x0, 90);
  assert.equal((box.x0 + box.x1) / 2, 500);
});

test("confident bat ends are included; low-confidence bat is ignored", () => {
  const bat: BatFrame[] = [{ frame: 10, tip: [700, 450], knob: [520, 450], conf: 0.8 }];
  assert.equal(subjectBoxAt([figure(10)], bat, 10, 1920, 1080)!.x1, 735);
  const weak: BatFrame[] = [{ frame: 10, tip: [700, 450], knob: [520, 450], conf: 0.1 }];
  assert.equal(subjectBoxAt([figure(10)], weak, 10, 1920, 1080)!.x1, 555);
});

test("fails closed when no frame has enough confident keypoints", () => {
  assert.equal(subjectBoxAt([figure(10, 0.2)], [], 10, 1920, 1080), null);
  assert.equal(subjectBoxAt([figure(10)], [], 50, 1920, 1080), null, "phase frame outside the pose data");
});

test("window union covers the batter's own movement and clamps to the frame", () => {
  const box = subjectBoxOverFrames([figure(1), figure(2, 0.9, 60)], [], 1, 2, 1920, 1080)!;
  assert.deepEqual([box.x0, box.x1], [445, 615]);
  const edge = subjectBoxOverFrames([{ frame: 1, keypoints: figure(1).keypoints.map(([x, y, c]) => [x + 1400, y, c]) }], [], 1, 1, 1920, 1080)!;
  assert.equal(edge.x1, 1920, "clamped to frame width");
});

test("a tracker jump to another player mid-window is left out of the box", () => {
  const box = subjectBoxOverFrames([figure(1), figure(2), figure(3, 0.9, 900)], [], 1, 3, 1920, 1080)!;
  assert.deepEqual([box.x0, box.x1], [445, 555]);
});

test("normalize and scale", () => {
  assert.deepEqual(normalizeBox({ x0: 192, y0: 108, x1: 384, y1: 540 }, 1920, 1080), { x: 0.1, y: 0.1, w: 0.1, h: 0.4 });
  assert.deepEqual(scaleBox({ x0: 384, y0: 216, x1: 768, y1: 1080 }, 3840, 2160, 1920, 1080), { x0: 192, y0: 108, x1: 384, y1: 540 });
});

test("an anchor frame keeps the box on the batter even when the window starts on someone else", () => {
  // Frame 1 is a glitch onto another player far away; frames 2-3 are the batter.
  const box = subjectBoxOverFrames([figure(1, 0.9, 900), figure(2), figure(3)], [], 1, 3, 1920, 1080, 2)!;
  assert.deepEqual([box.x0, box.x1], [445, 555]);
  // Without the anchor, the first usable frame (the glitch) would win.
  assert.equal(subjectBoxOverFrames([figure(1, 0.9, 900), figure(2), figure(3)], [], 1, 3, 1920, 1080)!.x0, 1345);
});

test("batterInBox checks the tracked body centre is inside a crop", () => {
  const box = { x0: 445, y0: 365, x1: 555, y1: 535 };
  assert.equal(batterInBox([figure(1)], 1, box), true);
  assert.equal(batterInBox([figure(1, 0.9, 900)], 1, box), false, "ran out of the crop");
  assert.equal(batterInBox([figure(1, 0.1)], 1, box), false, "not confidently tracked");
  assert.equal(batterInBox([figure(1)], 7, box), false, "no pose for that frame");
});
