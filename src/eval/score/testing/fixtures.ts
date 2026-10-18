import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWING_EVENTS, type ClipAnnotation } from '../../schema/annotation.ts';
import { canonicalJson, sha256 } from '../../benchmark/registry.ts';
import { digestRun, type InputClip, type Inputs, type Run, type Pairing } from '../inputs.ts';
export const repo = fileURLToPath(new URL('../../../../', import.meta.url));
export async function fixture(index = 1): Promise<InputClip> {
  const a: ClipAnnotation = JSON.parse(await readFile(new URL('../../../../eval/schema/examples/right-handed-swing.json', import.meta.url), 'utf8'));
  const id = 'eval_' + index.toString(16).padStart(16, '0'); a.eval_clip_id = id; a.source.sha256 = sha256(String(index));
  const registry = { eval_id: id, sha256: a.source.sha256, split: 'dev' as const, athlete_group: `group-${String(index).padStart(8, '0')}`,
    consent: { consent_ref: 'consent-00000001', eval_annotation: true, eval_external_ai: false }, status: 'active' as const, media_ext: 'mp4' as const };
  const pairs = a.swings.flatMap(s => SWING_EVENTS.map(event => {
    const gt = s.events[event]; return { swing_id: s.swing_id, event, gt: structuredClone(gt), engine: { status: 'observed', estimates: gt.frame ? [{ status: 'verified', frame: { ...gt.frame } }] : [] }, eligibility: gt.status === 'observed' ? 'eligible' : 'engine_not_produced' };
  }));
  return { annotation: a, registry, record: { schema: 'hitterloop.benchmark-clip', schema_version: '1.0.0', eval_id: id, status: 'paired', annotation: { sha256: sha256(JSON.stringify(a)) },
    gates: { status: 'evaluated', tuple: { engineCodeVersion: 'synthetic-1', instrumentationVersion: 'inst-1', environmentVersion: 'env-000000000001', gateVersion: 'gate-1', claimsVersion: 'claims-1', reliabilityVersion: 'reliability-1' },
      v1: { status: 'pass', reasons: [] }, v2: Object.fromEntries(SWING_EVENTS.map(e => [e, { status: 'pass' }])), clip_status: 'eligible', strict: { status: 'eligible' } } as unknown as InputClip['record']['gates'],
    pairing: { verified_slice: pairs, assumed_slice: [], outcomes: a.swings.map(s => ({ swing_id: s.swing_id, gt: s.outcome, engine: 'contact_unconfirmed' })), preconditions: [] } as unknown as Pairing } };
}
export function input(clips: InputClip[]): Inputs {
  return { root: '', directory: '', clips, failures: clips.filter(c => c.record.exclusion).map(c => ({ eval_id: c.record.eval_id, code: c.record.exclusion! })), annotation_digest: sha256('synthetic'),
    run: { schema: 'hitterloop.benchmark-run', schema_version: '1.0.0', runner_version: 'bench-1.0.0', run_id: 'run-0000000000000001',
      results_digest: sha256('synthetic run'), registry_sha256: sha256(canonicalJson({ registry_version: 1, clips: clips.map(c => c.registry) })),
      clip_list_sha256: sha256(canonicalJson(clips.map(c => c.record.eval_id).sort())), clip_count: clips.length, config: { split: 'dev' },
      engine_version: 'synthetic-1', tuples: clips.flatMap(c => c.record.gates?.tuple ? [c.record.gates.tuple as unknown as Record<string, unknown>] : []), preflight: { environment_version: 'env-000000000001' }, repeatability: { status: 'not_requested' } } };
}
export function exclude(c: InputClip, code = 'PIPELINE_FAILED') { c.record.status = 'excluded'; c.record.exclusion = code; delete c.record.gates; delete c.record.pairing; return c; }
export async function disk(clips: InputClip[] = []) {
  if (!clips.length) clips = [await fixture()];
  const root = await mkdtemp(join(tmpdir(), 'score-synthetic-')), i = input(clips); i.root = root;
  await mkdir(join(root, 'registry')); await mkdir(join(root, 'results'));
  await writeFile(join(root, 'registry', 'clips.jsonl'), [JSON.stringify({ registry_version: 1 }), ...clips.map(c => JSON.stringify(c.registry))].join('\n') + '\n');
  for (const c of clips) if (c.annotation) {
    const dir = join(root, 'annotations', '1.0.0', c.registry.eval_id); await mkdir(dir, { recursive: true });
    const bytes = JSON.stringify(c.annotation); c.record.annotation = { sha256: sha256(bytes) }; await writeFile(join(dir, 'ann_0000000000000001.json'), bytes);
  }
  await writeRun(i);
  return { input: i, root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
export async function writeRun(i: Inputs) {
  const dir = join(i.root, 'results', i.run.run_id); await mkdir(dir, { recursive: true }); i.directory = dir;
  const per = i.clips.map(c => canonicalJson(c.record)).join('\n') + '\n', f = i.failures.map(canonicalJson).join('\n') + (i.failures.length ? '\n' : '');
  i.run.results_digest = digestRun(i.run, per, f);
  await writeFile(join(dir, 'run.json'), canonicalJson(i.run)); await writeFile(join(dir, 'per_clip.jsonl'), per); await writeFile(join(dir, 'failures.jsonl'), f);
}
