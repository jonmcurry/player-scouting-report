import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Ajv } from "ajv";
import { annotationSchema, validateAnnotationStructure, validateAnnotation, validateAgainstSourceMedia, parseAnnotation, COCO_17, SWING_EVENTS, type ClipAnnotation, type EventLabel, type Landmark } from "./annotation.js";

const examples = new URL("../../../eval/schema/examples/", import.meta.url);
const load = (name = "right-handed-swing"): ClipAnnotation => JSON.parse(readFileSync(new URL(`${name}.json`, examples), "utf8"));
const jsonSchema = new Ajv({ allErrors: true, strict: true, strictTypes: false }).compile(JSON.parse(readFileSync(new URL("../../../eval/schema/annotation.v1.schema.json", import.meta.url), "utf8")));
// Portable structure must agree with the TS entry point. Cross-field/media checks
// are explicitly separate; claiming raw JSON Schema checks arbitrary PTS joins would be false.
function structureAgrees(value: unknown, expected?: boolean) {
  const standard = jsonSchema(value);
  assert.equal(validateAnnotationStructure(value).valid, standard, JSON.stringify(jsonSchema.errors));
  if (expected !== undefined) assert.equal(standard, expected, JSON.stringify(jsonSchema.errors));
}
const ref = (c: ClipAnnotation, i: number) => ({ frame_index: i, pts: c.source.presentation_timestamps[i]! });
const observed = (c: ClipAnnotation, i: number): EventLabel => ({ status: "observed", frame: ref(c,i), uncertainty: { earliest: ref(c,i), latest: ref(c,i) }, reason: null });
const ambiguous = (c: ClipAnnotation, a: number, b: number): EventLabel => ({ status: "ambiguous", frame: null, uncertainty: { earliest: ref(c,a), latest: ref(c,b) }, reason: "boundary_unclear" });

for (const file of readdirSync(examples)) test(`synthetic contract fixture: ${file}`, () => {
  const c = load(file.replace(/\.json$/, "")); const before = JSON.stringify(c);
  structureAgrees(c, true); assert.deepEqual(validateAnnotation(c), { valid: true, errors: [] });
  assert.equal(validateAgainstSourceMedia(c, structuredClone(c.source)).valid, true);
  assert.equal(parseAnnotation(c), c);
  assert.equal(JSON.stringify(c), before, "validation must not mutate/coerce input");
  assert.equal(c.data_origin, "synthetic"); assert.equal(c.source.sha256, "0".repeat(64));
});
test("schema and TS vocabulary are identical, with exactly the COCO-17 anatomical joints", () => {
  assert.deepEqual(Object.keys(annotationSchema.definitions.subject.properties.keypoints.properties), [...COCO_17]);
  assert.deepEqual(Object.keys(annotationSchema.definitions.swing.properties.events.properties), [...SWING_EVENTS]);
});
const structuralCases: [string, (c: any) => void][] = [
  ["none plus an obstruction", c => c.camera.obstructions.push("net")],

  ["unknown schema version", c => c.schema_version = "2.0.0"],
  ["missing frame identity", c => delete c.frames[0].frame.frame_index],
  ["missing event identity", c => delete c.swings[0].events.foot_plant.frame.pts],
  ["negative coordinate", c => c.frames[0].subjects[0].bat.knob.coordinates[0] = -0.1],
  ["out-of-bounds coordinate", c => c.frames[0].subjects[0].keypoints.nose.coordinates[1] = 1.01],
  ["non-finite coordinate", c => c.frames[0].subjects[0].bat.knob.coordinates[0] = Infinity],
  ["missing COCO joint", c => delete c.frames[0].subjects[0].keypoints.left_ankle],
  ["extra invented joint", c => c.frames[0].subjects[0].keypoints.tail = c.frames[0].subjects[0].keypoints.nose],
  ["occluded label claiming visible certainty", c => c.frames[0].subjects[0].keypoints.nose.visibility = 1],
  ["missing endpoint with invented coordinates", c => c.frames[0].subjects[0].bat.knob.status = "not_visible"],
  ["ambiguous point without uncertainty", c => { const p=c.frames[0].subjects[0].bat.knob; p.status="ambiguous";p.reason="motion_blur";p.uncertainty_radius=0; }],
  ["negative frame index", c => c.frames[0].frame.frame_index = -1],
  ["fractional PTS", c => c.source.presentation_timestamps[0] = 1.5],
  ["unsafe integer PTS", c => c.source.presentation_timestamps[0] = 2 ** 53],
  ["zero source dimension", c => c.source.width = 0],
  ["zero time base", c => c.source.time_base.denominator = 0],
  ["invalid source hash", c => c.source.sha256 = "not-a-hash"],
  ["invalid rotation", c => c.source.rotation_degrees = 30],
  ["invalid camera profile", c => c.camera.capture_profile = "perfect_3d"],
  ["personal annotator identity", c => c.annotators[0].annotator_id = "coach@example.com"],
  ["personal data extension", c => c.athlete_name = "Real Person"],
  ["frame rate timing shortcut", c => c.source.fps = 30],
  ["audio-only confirmed contact", c => c.swings[0].outcome_evidence = ["audio_crack"]],
  ["confirmed contact on a miss", c => c.swings[0].outcome = "swing_miss"],
  ["none combined with evidence", c => c.swings[0].outcome_evidence.push("none")],
  ["take with swing events", c => { c.swings[0].outcome="no_swing_take";c.swings[0].intent="take";c.swings[0].hitting_zone="not_reached";c.swings[0].outcome_evidence=["none"]; }],
  ["uncertainty inconsistent with event status", c => c.swings[0].events.foot_plant.uncertainty = null],
  ["reviewed without a reviewer", c => c.annotation.review.reviewer_ids = []],
  ["reviewed with unresolved disagreement", c => c.annotation.review.disagreement = "unresolved"],
  ["adjudicated without adjudicator", c => c.annotation.review.status = "adjudicated"],
];
for (const [name, mutate] of structuralCases) test(`JSON Schema and TypeScript reject ${name}`, () => {
  const c = load(); mutate(c); structureAgrees(c, false); assert.equal(validateAnnotation(c).valid, false); assert.throws(() => parseAnnotation(c));
});
const relationalCases: [string, (c: ClipAnnotation) => void][] = [
  ["incorrect frame/PTS mapping", c => c.frames[0]!.frame.pts += 1],
  ["out-of-range frame reference", c => c.frames[0]!.frame.frame_index = c.source.frame_count],
  ["frame count disagreement", c => c.source.frame_count++],
  ["reordered source PTS", c => [c.source.presentation_timestamps[1],c.source.presentation_timestamps[2]] = [c.source.presentation_timestamps[2]!,c.source.presentation_timestamps[1]!]],
  ["duplicate source PTS", c => c.source.presentation_timestamps[1] = c.source.presentation_timestamps[0]!],
  ["reversed bounding box", c => c.frames[0]!.subjects[0]!.bounding_box.coordinates = [.8,.8,.2,.2]],
  ["zero-area bounding box", c => c.frames[0]!.subjects[0]!.bounding_box.coordinates = [.2,.2,.2,.8]],
  ["duplicate annotated frame", c => c.frames.push(structuredClone(c.frames[0]!))],
  ["duplicate track identity", c => c.tracks.push(structuredClone(c.tracks[0]!))],
  ["unknown track", c => c.frames[0]!.subjects[0]!.track_id = "trk_ffffffffffffffff"],
  ["wrong batter identity", c => c.tracks[0]!.athlete_id = null],
  ["unknown candidate identity", c => { c.swings[0]!.batter_identity_status="ambiguous";c.swings[0]!.batter_track_id=null;c.swings[0]!.candidate_track_ids=["trk_ffffffffffffffff"]; }],
  ["impossible handedness/front leg", c => c.swings[0]!.front_leg = "right"],
  ["finish before launch", c => c.swings[0]!.events.finish = observed(c, 3)],
  ["observed with broad uncertainty", c => c.swings[0]!.events.load_start.uncertainty!.latest = ref(c, 2)],
  ["ambiguous with singleton interval", c => c.swings[0]!.events.load_start = ambiguous(c,1,1)],
  ["event outside attempt", c => c.swings[0]!.window.earliest = ref(c, 3)],
  ["unknown reviewer", c => c.annotation.review.reviewer_ids = ["ann_ffffffffffffffff"]],
  ["self review", c => c.annotation.review.reviewer_ids = [c.annotation.annotator_id]],
  ["duplicate annotator identity", c => c.annotators.push(structuredClone(c.annotators[0]!))],
  ["undeclared primary annotator", c => c.annotation.annotator_id = "ann_ffffffffffffffff"],
  ["unreviewed event in completed review", c => c.swings[0]!.events.load_start = {status:"not_annotated",frame:null,uncertainty:null,reason:"not_reviewed"}],
  ["fully occluded body with visible joints", c => c.frames[0]!.subjects[0]!.occlusion.body = "full"],
];
for (const [name, mutate] of relationalCases) test(`relational validation rejects ${name}`, () => {
  const c = load(); mutate(c); structureAgrees(c, true); assert.equal(validateAnnotation(c).valid, false, name);
});
test("uncertainty chains must have a feasible chronology, not merely pairwise overlap", () => {
  const c = load(); const e = c.swings[0]!.events;
  e.load_start = ambiguous(c,8,9);e.swing_launch=ambiguous(c,1,10);e.impact_estimate=ambiguous(c,5,6);
  assert.equal(validateAnnotation(c).valid, false);
});
test("foot plant may follow launch; overlapping estimates are not arbitrarily forced into total order", () => {
  const c=load();const e=c.swings[0]!.events;e.foot_plant=observed(c,6);e.swing_launch=observed(c,5);e.impact_estimate=ambiguous(c,5,7);
  assert.equal(validateAnnotation(c).valid,true);
});
test("valid missing observations, ambiguous identity, and adjudication are retained", () => {
  const c=load();const s=c.swings[0]!;s.batter_identity_status="ambiguous";s.batter_track_id=null;s.candidate_track_ids=[c.tracks[0]!.track_id];
  s.events.load_start={status:"not_visible",frame:null,uncertainty:null,reason:"occluded"};
  c.annotators.push({annotator_id:"ann_0000000000000003",role:"adjudicator",qualification:"baseball_coach"});
  c.annotation.review={status:"adjudicated",reviewer_ids:["ann_0000000000000002"],adjudicator_id:"ann_0000000000000003",disagreement:"resolved"};
  structureAgrees(c,true);assert.equal(validateAnnotation(c).valid,true);
});
test("VFR uses original integer PTS, including nonzero/negative starts; coherent forgery needs external source checking", () => {
  const c=load("variable-frame-rate");const original=structuredClone(c.source);
  assert.equal(c.source.presentation_timestamps[0],-20);
  assert.notEqual(c.frames[0]!.frame.pts, c.frames[0]!.frame.frame_index * 30);
  c.source.presentation_timestamps=c.source.presentation_timestamps.map(p=>p+100);
  function shift(value: any) { if (value && typeof value === "object") {if ("frame_index" in value) value.pts+=100; else Object.values(value).forEach(shift);} }
  shift(c.frames);shift(c.swings);
  assert.equal(validateAnnotation(c).valid,true,"document can be internally coherent but wrong");
  assert.equal(validateAgainstSourceMedia(c,original).valid,false);
  for (const field of ["sha256","width","video_stream_index","frame_count","rotation_degrees"] as const) {
    const wrong:any=structuredClone(original);wrong[field]=field==="sha256"?"f".repeat(64):field==="rotation_degrees"?90:wrong[field]+1;
    assert.equal(validateAgainstSourceMedia(load("variable-frame-rate"),wrong).valid,false);
  }
});

test("a held bunt need not have a conventional load, stride or forward launch", () => {
  const c=load();const s=c.swings[0]!;s.intent="bunt";
  for (const e of ["load_start","stride_foot_lift","foot_plant","swing_launch"] as const) s.events[e]={status:"not_applicable",frame:null,uncertainty:null,reason:"no_distinct_action"};
  structureAgrees(c,true);assert.equal(validateAnnotation(c).valid,true);
});
test("required synthetic scenarios cannot silently disappear", () => {
  const names=readdirSync(examples);
  for(const name of ["right-handed-swing","left-handed-swing","swing-and-miss","take","checked-swing","obscured-batter","missing-bat-endpoints","variable-frame-rate","ambiguous-contact","confirmed-contact-unknown-direction"]) assert.ok(names.includes(`${name}.json`));
});

// Static conformance is checked by npm run build as well as runtime validation.
// @ts-expect-error Missing landmarks cannot claim visible coordinates.
const invalidLandmark: Landmark = {status:"not_visible",coordinates:null,uncertainty_radius:null,reason:"occluded",visibility:2};
test("missing landmark visibility is rejected at runtime too", () => {
  const c=load();c.frames[0]!.subjects[0]!.keypoints.nose=invalidLandmark;
  structureAgrees(c,false);
});
test("inclusive attempt windows cannot share a boundary frame", () => {
  const c=load("take");const first=c.swings[0]!;
  first.window.latest=ref(c,5);
  const second=structuredClone(first);second.swing_id="swg_ffffffffffffffff";
  second.window={earliest:ref(c,5),latest:ref(c,10)};second.events.stance_set=observed(c,5);c.swings.push(second);
  structureAgrees(c,true);assert.equal(validateAnnotation(c).valid,false);
  second.window.earliest=ref(c,6);second.events.stance_set=observed(c,6);
  assert.deepEqual(validateAnnotation(c),{valid:true,errors:[]});
});
test("unresolved draft retains distinct declared reviewers without claiming completed review", () => {
  const c=load();c.annotation.review.status="draft";c.annotation.review.disagreement="unresolved";
  structureAgrees(c,true);assert.equal(validateAnnotation(c).valid,true);
  c.annotation.review.reviewer_ids=[c.annotation.annotator_id];assert.equal(validateAnnotation(c).valid,false);
  c.annotation.review.reviewer_ids=["ann_ffffffffffffffff"];assert.equal(validateAnnotation(c).valid,false);
  c.annotation.review.reviewer_ids=[];structureAgrees(c,false);
  c.annotation.review.disagreement="resolved";structureAgrees(c,false);
});
for(const reason of ["no_contact","no_stride","no_swing","no_distinct_action"] as const) test(`unreached zone rejects impact reason ${reason}`,()=>{
  const c=load("checked-swing");c.swings[0]!.events.impact_estimate.reason=reason;structureAgrees(c,false);
});
