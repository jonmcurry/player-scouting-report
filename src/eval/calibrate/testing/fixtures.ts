import { fixture as scoreFixture, input } from '../../score/testing/fixtures.ts';
import { INITIAL_EVIDENCE_TUPLE } from '../../../services/development/evidenceRegistry.ts';
import { sha256 } from '../../benchmark/registry.ts';
import type { Observation } from '../observations.ts';
import { eligibleDataset } from '../eligibility.ts';

export async function inputs(index = 1, split = 'validation') {
  const c = await scoreFixture(index);
  c.registry.split = split as 'dev' | 'validation';
  c.record.gates!.tuple = { ...INITIAL_EVIDENCE_TUPLE };
  const i = input([c]);
  i.run.run_id = 'run-' + index.toString(16).padStart(16, '0');
  i.run.config.split = split; i.run.engine_version = INITIAL_EVIDENCE_TUPLE.engineCodeVersion;
  i.run.preflight.environment_version = INITIAL_EVIDENCE_TUPLE.environmentVersion;
  i.run.tuples = [{ ...INITIAL_EVIDENCE_TUPLE }];
  return i;
}
export async function dataset() { return eligibleDataset([await inputs()]); }
export function observation(index = 1, overrides: Partial<Observation> = {}): Observation {
  return { athlete_group: `synthetic-athlete-${index}`, capture_profile: 'game_backstop', concept: 'contact',
    clip_hash: sha256('clip-' + index), swing_hash: sha256('swing-' + index), v1: 'pass',
    v2: { impact_estimate: 'pass' }, v3: 'sufficient',
    evidence: { identity: 'correct', visibility: 'correct', timing: { impact_estimate: 'correct' } }, ...overrides };
}
export function observations(athletes = 20, swings = 5) {
  return Array.from({ length: athletes * swings }, (_, n) => observation(n, { athlete_group: `synthetic-athlete-${Math.floor(n / swings)}` }));
}
