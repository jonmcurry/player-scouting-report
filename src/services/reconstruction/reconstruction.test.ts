import assert from "node:assert/strict";
import test from "node:test";
import { hitterLoopToThree, mirrorBatterLeftRight, videoPose3dToHitterLoop } from "./coordinates.js";
import { inferHandedness } from "./handedness.js";
import { interpolateShortGaps } from "./temporal.js";
import { boneLengthVariance, footSlidingScore, lockPlantedFoot, stabilizeBoneLengths } from "./stabilization.js";
import { newAnimation, validateAnimation } from "./serialization.js";
import type { Vec3 } from "./types.js";

test("short gaps interpolate and long gaps remain missing", () => {
  const short=interpolateShortGaps([{value:0,confidence:1},{value:null,confidence:0},{value:2,confidence:1}],2);
  assert.equal(short[1]!.value,1); assert.equal(short[1]!.status,"interpolated");
  const long=interpolateShortGaps([{value:0,confidence:1},{value:null,confidence:0},{value:null,confidence:0},{value:3,confidence:1}],1);
  assert.equal(long[1]!.status,"missing");
});

test("bone stabilization removes length variance while preserving direction", () => {
  const frames:Vec3[][]=[[[0,0,0],[1,0,0]],[[0,0,0],[2,0,0]],[[0,0,0],[3,0,0]]];
  const before=boneLengthVariance(frames,[[0,1]]); const afterFrames=stabilizeBoneLengths(frames,{1:0});
  assert.ok(before>0.3); assert.ok(boneLengthVariance(afterFrames,[[0,1]])<1e-9); assert.ok(afterFrames[1]![1]![0]>0);
});

test("foot locking reduces planted sliding but leaves fast stride motion", () => {
  const frames:Vec3[][]=[]; for(let i=0;i<8;i++) frames.push([[i*0.005,1,0],[i*0.005,0,0]]);
  frames.push([[1,1,0],[1,0,0]]);
  const locked=lockPlantedFoot(frames,1,0.01,4);
  assert.ok(footSlidingScore(locked,1,0.01)<footSlidingScore(frames,1,0.01));
  assert.equal(locked[8]![1]![0],1);
});

test("coordinate conversion is explicit and mirroring only flips X", () => {
  assert.deepEqual(videoPose3dToHitterLoop([1,2,3]),[1,3,2]);
  assert.deepEqual(hitterLoopToThree([1,3,2]),[1,3,-2]);
  assert.deepEqual(mirrorBatterLeftRight([1,3,2]),[-1,3,2]);
});

test("handedness uses evidence and respects coach override", () => {
  assert.deepEqual(inferHandedness([{side:"left",confidence:.8},{side:"right",confidence:.2}]).handedness,"left");
  assert.equal(inferHandedness([],"right").method,"coach_override");
});

test("animation serialization validates timeline and version", () => {
  const a=newAnimation(30); validateAnimation(a);
  a.frames=[{frame:1,t:1,rootPosition:[0,0,0],rootRotation:[0,0,0,1],joints:{},bat:null,confidence:1},{frame:0,t:0,rootPosition:[0,0,0],rootRotation:[0,0,0,1],joints:{},bat:null,confidence:1}];
  assert.throws(()=>validateAnimation(a),/monotonic/);
});
