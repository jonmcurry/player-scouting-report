import test from 'node:test';
import assert from 'node:assert/strict';
import { events, pair, timing } from './events.ts';
import { fixture, exclude } from './testing/fixtures.ts';
import { ELIGIBILITIES } from '../benchmark/pairing.ts';
test('observed timing uses GT frame and PTS inside a non-degenerate uncertainty interval', async () => {
  const c = await fixture(), s = c.annotation!.swings[0]!, p = pair(c, s, 'impact_estimate')!;
  s.events.impact_estimate = { status: 'observed', frame: { frame_index: 10, pts: 5120 }, uncertainty: { earliest: { frame_index: 8, pts: 4096 }, latest: { frame_index: 12, pts: 6144 } }, reason: null };
  p.gt = structuredClone(s.events.impact_estimate); p.engine.estimates[0]!.frame = { frame_index: 12, pts: 6144 };
  c.annotation!.source.time_base = { numerator: 1, denominator: 15360 };
  const t = timing(c, s, 'impact_estimate')!;
  assert.equal(t.frames, 2); assert.equal(t.ms, 1024 * 1000 / 15360);
  const m = events([c], 1);
  assert.equal(m.find(x => x.id === 'E1.impact_estimate.frames.median')!.value, 2);
  assert.equal(m.find(x => x.id === 'E1.impact_estimate.hit_66_ms')!.value, 0);
});
test('perfect E1 and E2, nearest-rank offsets and nontrivial PTS conversion', async () => {
  const clips = await Promise.all([1, 2, 3, 4].map(fixture));
  for (const c of clips) { const m = events([c], 1); assert.equal(m.find(x => x.id === 'E1.impact_estimate.frames.median')!.value, 0); assert.equal(m.find(x => x.id === 'E1.impact_estimate.hit_1_frames')!.value, 1); }
  clips.forEach((c, i) => { const s = c.annotation!.swings[0]!, p = pair(c, s, 'impact_estimate')!; c.annotation!.source.time_base = { numerator: 1, denominator: 15360 }; p.engine.estimates[0]!.frame!.frame_index += i; p.engine.estimates[0]!.frame!.pts += [0, 506, 507, 1014][i]!; });
  const m = events(clips, 1), get = (id: string) => m.find(x => x.id === `E1.impact_estimate.${id}`)!.value;
  assert.equal(get('frames.median'), 1.5); assert.equal(get('frames.p90'), 3); assert.equal(get('hit_1_frames'), 0.5);
  assert.equal(get('hit_33_ms'), 0.5); assert.equal(get('hit_66_ms'), 0.75); assert.equal(get('ms.p90'), 1014 * 1000 / 15360);
});
test('exact ±33/66 ms inclusive boundaries', async () => {
  const clips = await Promise.all([1, 2].map(fixture));
  clips.forEach((c, i) => { const p = pair(c, c.annotation!.swings[0]!, 'impact_estimate')!; p.engine.estimates[0]!.frame!.pts += [33, 66][i]!; });
  const m = events(clips, 1); assert.equal(m.find(x => x.id === 'E1.impact_estimate.hit_33_ms')!.value, 0.5); assert.equal(m.find(x => x.id === 'E1.impact_estimate.hit_66_ms')!.value, 1);
});
test('ambiguous windows separate from observed timing; inside zero and exact outside distance', async () => {
  const c = await fixture(), s = c.annotation!.swings[0]!, p = pair(c, s, 'impact_estimate')!;
  s.events.impact_estimate = { status: 'ambiguous', frame: null, uncertainty: { earliest: { frame_index: 5, pts: 9150 }, latest: { frame_index: 7, pts: 9210 } }, reason: 'boundary_unclear' };
  p.eligibility = 'eligible_gt_ambiguous'; assert.equal(timing(c, s, 'impact_estimate', true)!.frames, 0);
  p.engine.estimates[0]!.frame = { frame_index: 9, pts: 9270 }; assert.equal(timing(c, s, 'impact_estimate', true)!.frames, 2); assert.equal(timing(c, s, 'impact_estimate', true)!.ms, 60);
  const m = events([c], 1); assert.equal(m.find(x => x.id === 'E1.impact_estimate.frames.median')!.status, 'unmeasured'); assert.equal(m.find(x => x.id === 'E2.impact_estimate')!.denominator, 0);
});
test('all nondetected reasons and excluded clips remain in E2; assumed never scores', async () => {
  const reasons = ELIGIBILITIES.filter(e => !['eligible', 'eligible_gt_ambiguous', 'gt_not_observed', 'gt_not_applicable', 'gt_not_annotated'].includes(e));
  const clips = await Promise.all(reasons.map((_, i) => fixture(i + 1)));
  clips.forEach((c, i) => { const p = pair(c, c.annotation!.swings[0]!, 'impact_estimate')!; p.eligibility = reasons[i]!; if (p.eligibility === 'engine_identity_assumed') { p.engine.estimates[0]!.status = 'assumed'; c.record.pairing!.assumed_slice.push(p as never); c.record.pairing!.verified_slice = c.record.pairing!.verified_slice.filter(x => x !== p); } });
  clips.push(exclude(await fixture(100))); const m = events(clips, 1).find(x => x.id === 'E2.impact_estimate')!;
  assert.equal(m.denominator, reasons.length + 1); assert.equal(m.numerator, 0); for (const r of reasons) assert.equal(m.exclusions[r], 1);
});
test('GT missing states excluded; contact baseline N/A; impact never a contact claim; E4 violation', async () => {
  const c = await fixture(), s = c.annotation!.swings[0]!;
  for (const status of ['not_visible', 'not_applicable', 'not_annotated', 'ambiguous'] as const) { const copy = structuredClone(c); copy.annotation!.swings[0]!.events.impact_estimate.status = status; assert.equal(events([copy], 1).find(x => x.id === 'E2.impact_estimate')!.denominator, 0); }
  c.record.pairing!.verified_slice = c.record.pairing!.verified_slice.filter(p => p.event !== 'contact_confirmed');
  for (const m of events([c], 1).filter(m => m.id.startsWith('E3'))) { assert.equal(m.status, 'not_applicable'); assert.equal(m.reason, 'engine_never_claims_contact_confirmed'); }
  pair(c, s, 'impact_estimate')!.engine.estimates[0]!.frame!.frame_index = 0;
  assert.equal(events([c], 1).find(x => x.id === 'E4')!.value, 1);
});
