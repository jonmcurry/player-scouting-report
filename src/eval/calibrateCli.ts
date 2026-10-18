import { loadPreregistration } from './calibrate/preregistration.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { canonicalJson } from './benchmark/registry.ts';
import { evalRoot, safePath } from './score/inputs.ts';
import { argumentsFor } from './scoreRun.ts';
import { eligibleDataset, loadScoredInputs } from './calibrate/eligibility.ts';
import { buildProfile, validateDate } from './calibrate/reliabilityProfile.ts';
import { measurementRecords } from './calibrate/measurementRecords.ts';
import { random } from './stats/clusterBootstrap.ts';
import type { ReliabilityProfile } from '../services/development/evidence/reliability.ts';

export function renderCalibration(profile: ReliabilityProfile) {
  const lines = ['# Private reliability calibration', '', 'Experimental; not production acceptance; not registered.',
    ...(profile.data_origin === 'synthetic' ? ['SYNTHETIC DATA — no empirical production reliability claim.'] : []),
    'Validation only. Threshold selection deferred. Concept-level estimates only; per-event reliability is not supported.', '',
    '| Concept | Capture slice | Status | Measurable passes | Athletes | Unmeasurable | Unsafe rate | Upper 95% | Measurable coverage | Coverage gate |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---|'];
  const profiles = [...new Set(profile.entries.map(e => e.capture_profile))].sort();
  for (const e of profile.entries) lines.push(`| ${e.concept} | ${profiles.indexOf(e.capture_profile) + 1} | ${e.status} | ${e.n_swings} | ${e.n_athletes} | ${e.n_unmeasurable} | ${e.observed_unsafe_rate ?? 'unmeasured'} | ${e.upper_bound_95 ?? 'unmeasured'} | ${e.measurable_coverage ?? 'not_applicable'} | ${e.coverage_gate} |`);
  // Capture profiles are a camera taxonomy, not athlete identifiers.
  lines.push('', '| Capture slice | Capture profile |', '|---:|---|', ...profiles.map((p, i) => `| ${i + 1} | ${p} |`));
  lines.push('', 'Unmeasured: no measurable claim passes. Inconclusive: insufficient sample, upper bound above the provisional ceiling, or missing/unmet pre-registered coverage policy.',
    'PR13 does not evaluate V3 or engine subject identity. Environment identity is not evidence of accuracy.',
    'Private aggregate report. No publication or persistence is performed.');
  return lines.join('\n') + '\n';
}
export async function calibrate(rootValue: string, repo: string, profileRuns: string[], diagnosticRuns: string[], date: string, seed = 1, coveragePreregistrationPath?: string) {
  validateDate(date); random(seed);
  const root = await evalRoot(rootValue, repo);
  const profileInputs = await Promise.all(profileRuns.map(id => loadScoredInputs(root, repo, id)));
  const diagnosticInputs = await Promise.all(diagnosticRuns.map(id => loadScoredInputs(root, repo, id)));
  const policy = coveragePreregistrationPath === undefined ? undefined : await loadPreregistration(root, coveragePreregistrationPath);
  const dataset = eligibleDataset(profileInputs, diagnosticInputs, policy), profile = buildProfile(dataset, date, seed);
  const payload = measurementRecords(profile, dataset.inputs.flatMap(i => i.clips.flatMap(c => c.annotation ? [c.annotation] : [])));
  const directory = await safePath(root, 'calibration', profile.version);
  await mkdir(await safePath(root, 'calibration'), { recursive: true });
  try { await mkdir(directory); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('CALIBRATION_ALREADY_EXISTS'); throw e; }
  for (const [name, bytes] of [['profile.json', canonicalJson(profile) + '\n'],
    ['measurement-payloads.json', canonicalJson(payload) + '\n'], ['report.md', renderCalibration(profile)]]) {
    await writeFile(await safePath(root, 'calibration', profile.version, name!), bytes!, { flag: 'wx' });
  }
  return profile;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const a = argumentsFor(process.argv.slice(2), ['--profile-run', '--diagnostic-run', '--date', '--seed', '--coverage-preregistration']);
    if (!a['--profile-run'] || !a['--date']) throw new Error('INVALID_ARGUMENTS');
    await calibrate(process.env.HITTERLOOP_EVAL_ROOT ?? '', fileURLToPath(new URL('../../', import.meta.url)),
      a['--profile-run'].split(','), a['--diagnostic-run']?.split(',') ?? [], a['--date'], a['--seed'] === undefined ? 1 : Number(a['--seed']), a['--coverage-preregistration']);
    console.log('Experimental calibration written privately under EVAL_ROOT. Not registered; not production acceptance.');
  } catch (e) { console.error(e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : 'CALIBRATION_FAILED'); process.exitCode = 1; }
}
