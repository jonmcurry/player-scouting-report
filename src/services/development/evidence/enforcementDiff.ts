/**
 * PR17 (S1-12) enforcement dry-run diff: the aggregate effect a cut-over WOULD have.
 * Pure and Deno-portable; reads nothing and decides nothing. Counts only - no clip,
 * player, run or issue identifiers - and small cells are suppressed. Its digest is
 * what the product owner records as shadowDiffReviewed.diffDigest after review.
 */
import { CLAIM_REQUIREMENTS } from './claimRequirements.ts';
import { portableCanonicalJson, portableSha256 } from './enforceability.ts';
import type { Concept } from './types.ts';

export interface DiffRun { has_assessment: boolean; clip_status: string | null; family_reason: string | null;
  issues: { concept: string | null; claim_decision: unknown }[] }
export interface DiffFocus { concept: string; status: string }
export const DIFF_SUPPRESSION_MINIMUM = 5; // Mirrors the plan's 7.5 five-athlete small-cell rule for counts.
export const SUPPRESSED = 'suppressed (small sample)';
type Cell = number | typeof SUPPRESSED;
const cell = (n: number): Cell => n > 0 && n < DIFF_SUPPRESSION_MINIMUM ? SUPPRESSED : n;

export interface EnforcementDiff {
  schema: 'hitterloop.enforcement-diff'; schema_version: '1.0.0'; enforced_concepts: string[];
  runs: { total: Cell; assessed: Cell; legacy_unassessed: Cell };
  withheld: { overall: Cell; by_family_reason: Record<string, Cell> };
  concepts: Record<string, { issues: Cell; would_display: Cell; would_disappear: Cell }>;
  focus: Record<string, { kept_rechecking: Cell; other_open: Cell }>;
  legacy_safe_only: { runs_without_ai_summary_or_fix: Cell };
  note: string; digest: string;
}
function wouldDisplay(run: DiffRun, concept: string | null, decision: unknown, enforced: Set<string>): boolean {
  const h = (decision as { hypothetical?: { wouldDisplay?: unknown } } | null)?.hypothetical;
  return run.has_assessment && run.clip_status === 'eligible' && !!concept && enforced.has(concept) && h?.wouldDisplay === true;
}
export async function enforcementDiff(runs: readonly DiffRun[], focus: readonly DiffFocus[], enforcedConcepts: readonly string[]): Promise<EnforcementDiff> {
  if (!enforcedConcepts.length || new Set(enforcedConcepts).size !== enforcedConcepts.length
    || !enforcedConcepts.every(c => Object.hasOwn(CLAIM_REQUIREMENTS, c) && !CLAIM_REQUIREMENTS[c as Concept].disabledReason))
    throw new Error('INVALID_ENFORCED_CONCEPTS');
  const enforced = new Set(enforcedConcepts);
  const assessed = runs.filter(r => r.has_assessment), withheld = assessed.filter(r => r.clip_status !== 'eligible');
  const reasons: Record<string, number> = {};
  for (const r of withheld) reasons[r.family_reason ?? 'unspecified'] = (reasons[r.family_reason ?? 'unspecified'] ?? 0) + 1;
  const concepts: Record<string, { issues: number; would_display: number }> = {};
  for (const r of runs) for (const i of r.issues) {
    const key = i.concept ?? 'unclassified', c = concepts[key] ??= { issues: 0, would_display: 0 };
    c.issues++; if (wouldDisplay(r, i.concept, i.claim_decision, enforced)) c.would_display++;
  }
  const focusCounts: Record<string, { kept_rechecking: number; other_open: number }> = {};
  for (const f of focus) {
    const c = focusCounts[f.concept] ??= { kept_rechecking: 0, other_open: 0 };
    // Never demoted at cut-over: active/improving keep their status and freeze until 3 eligible swings.
    if (f.status === 'active' || f.status === 'improving') c.kept_rechecking++; else c.other_open++;
  }
  const sorted = <T>(o: Record<string, T>) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]!]));
  const body = { schema: 'hitterloop.enforcement-diff' as const, schema_version: '1.0.0' as const, enforced_concepts: [...enforcedConcepts].sort(),
    runs: { total: cell(runs.length), assessed: cell(assessed.length), legacy_unassessed: cell(runs.length - assessed.length) },
    withheld: { overall: cell(withheld.length), by_family_reason: sorted(Object.fromEntries(Object.entries(reasons).map(([k, n]) => [k, cell(n)]))) },
    concepts: sorted(Object.fromEntries(Object.entries(concepts).map(([k, c]) => [k,
      { issues: cell(c.issues), would_display: cell(c.would_display), would_disappear: cell(c.issues - c.would_display) }]))),
    focus: sorted(Object.fromEntries(Object.entries(focusCounts).map(([k, c]) => [k, { kept_rechecking: cell(c.kept_rechecking), other_open: cell(c.other_open) }]))),
    legacy_safe_only: { runs_without_ai_summary_or_fix: cell(runs.length - assessed.length) },
    note: 'Dry run only. Nothing is enforced; stored focus is never rewritten. Requires product-owner review before any S1-12 cut-over.' };
  return { ...body, digest: await portableSha256(portableCanonicalJson(body)) };
}
export function renderEnforcementDiff(d: EnforcementDiff): string {
  const rows = (o: Record<string, Record<string, Cell>>) => Object.entries(o).map(([k, v]) => `| ${k} | ${Object.values(v).join(' | ')} |`);
  return ['# Enforcement dry-run diff (aggregate)', '', d.note, '', `Enforced concepts: ${d.enforced_concepts.join(', ')}`, '',
    `Runs: ${d.runs.total} (assessed ${d.runs.assessed}, legacy unassessed ${d.runs.legacy_unassessed}); withheld clips: ${d.withheld.overall}`, '',
    '| Concept | Issues | Would display | Would disappear |', '|---|---:|---:|---:|', ...rows(d.concepts), '',
    '| Focus concept | Kept, re-checking | Other open |', '|---|---:|---:|', ...rows(d.focus), '',
    `Legacy runs shown without AI summary or fix (legacy_safe_only): ${d.legacy_safe_only.runs_without_ai_summary_or_fix}`, '',
    `Digest: ${d.digest}`].join('\n') + '\n';
}
