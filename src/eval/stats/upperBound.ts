export interface AthleteCount { numerator: number; denominator: number }
/** Binary-response one-way random-effects ANOVA, unequal cluster sizes. */
export function upperBound(groups: AthleteCount[]) {
  const g = groups.filter(x => x.denominator > 0), k = g.length;
  const n = g.reduce((s, x) => s + x.denominator, 0);
  if (!n) return { upper: null, n_eff: 0, deff: null, icc: 0.1, mean_units: 0 };
  const mean = g.reduce((s, x) => s + x.numerator, 0) / n;
  const between = g.reduce((s, x) => s + x.denominator * (x.numerator / x.denominator - mean) ** 2, 0);
  const within = g.reduce((s, x) => s + x.numerator * (1 - x.numerator / x.denominator), 0);
  const msb = between / (k - 1), msw = within / (n - k);
  const n0 = (n - g.reduce((s, x) => s + x.denominator ** 2, 0) / n) / (k - 1);
  const estimate = (msb - msw) / (msb + (n0 - 1) * msw);
  const icc = Number.isFinite(estimate) ? Math.max(estimate, 0.1) : 0.1;
  const mean_units = n / k, deff = 1 + (mean_units - 1) * icc, n_eff = n / deff;
  return { upper: 3 / n_eff, n_eff, deff, icc, mean_units };
}
