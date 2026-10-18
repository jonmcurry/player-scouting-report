import { upperBound, type AthleteCount } from './upperBound.ts';
export const REPLICATES = 2000;
export const DEFAULT_SEED = 1;
/** Mulberry32; seed is an unsigned 32-bit integer. Constants are algorithm parameters, not decision thresholds. */
export function random(seed: number) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('INVALID_SEED');
  return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  return [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(p * values.length) - 1)]!;
}
export function bootstrap<T>(groups: T[], statistic: (sample: T[]) => number | null, seed = DEFAULT_SEED) {
  const rng = random(seed), values: number[] = [];
  for (let i = 0; i < REPLICATES; i++) {
    const value = statistic(groups.map(() => groups[Math.floor(rng() * groups.length)]!));
    if (value !== null && Number.isFinite(value)) values.push(value);
  }
  return { ci95: [percentile(values, 0.025), percentile(values, 0.975)], upper95: percentile(values, 0.95),
    dropped_replicates: REPLICATES - values.length, seed, replicates: REPLICATES };
}
export function ratio(groups: AthleteCount[]) {
  const d = groups.reduce((s, g) => s + g.denominator, 0);
  return d ? groups.reduce((s, g) => s + g.numerator, 0) / d : null;
}
export function clusterBootstrap(groups: AthleteCount[], seed = DEFAULT_SEED) {
  const eligible = groups.filter(g => g.denominator > 0), result = bootstrap(eligible, ratio, seed);
  const zero = eligible.length > 0 && eligible.every(g => g.numerator === 0);
  const adjustment = zero ? upperBound(eligible) : null;
  return { ...result, upper95: adjustment ? adjustment.upper : result.upper95, rule_of_three: adjustment,
    sample_status: eligible.length < 5 ? 'insufficient_sample' : 'adequate' };
}
