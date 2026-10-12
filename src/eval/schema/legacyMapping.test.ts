import test from "node:test";
import assert from "node:assert/strict";
import { translateLegacyPhases } from "./legacyMapping.js";

test("legacy contact is only impact; load is an auxiliary peak, never load_start", () => {
  const input = { "phases.contact": { frame: 42, time_s: 1.4 }, "phases.load": { frame: 30, time_s: 1 }, "phases.stride": { frame: 35, time_s: 1.17 } } as const;
  const before=JSON.stringify(input);const output=translateLegacyPhases(input);
  assert.equal(output.events.impact_estimate.status,"legacy_estimate");
  assert.equal(output.events.contact_confirmed.status,"not_produced");
  assert.equal(output.events.load_start.status,"not_produced");
  assert.equal(output.events.foot_plant.status,"legacy_estimate");
  assert.deepEqual(output.auxiliary.load_peak_estimate.estimates[0],{legacy_phase:"load",source_field:"phases.load",legacy_frame:30,legacy_time_s:1,method:"baseline_wrist_extremum",temporal_identity:"unverified_legacy"});
  assert.equal(JSON.stringify(input),before);
});
test("missing events stay not_produced; no swing or contact conclusion is synthesized", () => {
  const output=translateLegacyPhases({"phases.contact":{frame:null,time_s:null}});
  for (const e of [...Object.values(output.events),...Object.values(output.auxiliary)]) assert.deepEqual(e,{status:"not_produced",estimates:[]});
});
test("all aliases preserve provenance without converting legacy time into source PTS", () => {
  const o=translateLegacyPhases({"metrics.json.contact":{frame:20,time_s:2},"phases.contact":{frame:21,time_s:2.1},"phases.stance":{frame:0,time_s:0},"phases.follow_through":{frame:40,time_s:4},"phases.extension":{frame:50,time_s:5}});
  assert.deepEqual(o.events.impact_estimate.estimates.map(e=>e.source_field),["metrics.json.contact","phases.contact"]);
  assert.equal(o.events.stance_set.status,"legacy_estimate");assert.equal(o.events.finish.status,"legacy_estimate");
  assert.equal(o.auxiliary.extension.status,"legacy_estimate");
  assert.equal(o.events.stride_foot_lift.status,"not_produced");assert.equal(o.events.swing_launch.status,"not_produced");
  assert.ok(!JSON.stringify(o).includes('"pts"'));
});
test("malformed/unknown legacy fields are rejected rather than guessed", () => {
  for (const input of [{"phases.load_start":{frame:1,time_s:1}},{"phases.contact":{frame:-1,time_s:0}},{"phases.load":{frame:3}},{"phases.contact":{frame:1,time_s:NaN}}]) assert.throws(()=>translateLegacyPhases(input as any));
});
