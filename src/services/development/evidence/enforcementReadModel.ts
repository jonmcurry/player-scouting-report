/**
 * PR17 read model for enforceability and the enforcement dry-run diff. Pure SQL text
 * builders plus row mappers; no client, no I/O, never imported by production code.
 * Every query is read-only and must run with a service-role (or test superuser)
 * connection, because 00066 approvals and assessments are not client-readable.
 */
import type { ConceptApprovalRecord } from './enforceability.ts';
import type { DiffRun, DiffFocus } from './enforcementDiff.ts';

const CLAIMS_VERSION = /^claims-[0-9]+\.[0-9]+\.[0-9]+(-proposed)?$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Latest-first, deterministic order; the enforceability contract also re-sorts. */
export function approvalsQuery(claimsVersion: string): string {
  if (!CLAIMS_VERSION.test(claimsVersion)) throw new Error('INVALID_CLAIMS_VERSION');
  return `select coalesce(json_agg(json_build_object('id', id, 'concept', concept, 'claims_version', claims_version,
  'requirement_sha256', requirement_sha256, 'reviewer_id', reviewer_id, 'decision', decision,
  'decided_at', to_char(decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by decided_at desc, id desc), '[]'::json)
from public.concept_requirement_approvals where claims_version = '${claimsVersion}';`;
}
export const ACTIVE_CONCEPT_REVIEWERS_QUERY = `select coalesce(json_agg(user_id order by user_id), '[]'::json)
from public.curation_reviewers where role = 'concept_reviewer' and revoked_at is null;`;
/** Aggregate inputs only: no clip, player, run or issue identifiers leave the database. */
export const DIFF_INPUTS_QUERY = `select json_build_object(
  'runs', coalesce((select json_agg(json_build_object(
      'has_assessment', a.id is not null, 'clip_status', a.clip_status, 'family_reason', a.family_reason,
      'issues', coalesce((select json_agg(json_build_object('concept', i.concept, 'claim_decision', i.claim_decision))
        from public.issues i where i.analysis_run_id = r.id), '[]'::json)))
    from public.analysis_runs r left join public.clip_evidence_assessments a on a.id = r.evidence_assessment_id), '[]'::json),
  'focus', coalesce((select json_agg(json_build_object('concept', f.concept, 'status', f.status))
    from public.player_focus f where f.ended_at is null), '[]'::json));`;

const array = (v: unknown, code: string): unknown[] => { if (!Array.isArray(v)) throw new Error(code); return v; };
export function mapApprovals(json: unknown): ConceptApprovalRecord[] {
  return array(json, 'INVALID_APPROVAL_ROWS').map(r => {
    const x = r as Record<string, unknown>;
    if (typeof x.id !== 'string' || !UUID.test(x.id) || typeof x.reviewer_id !== 'string' || !UUID.test(x.reviewer_id)
      || typeof x.concept !== 'string' || typeof x.claims_version !== 'string' || typeof x.requirement_sha256 !== 'string'
      || (x.decision !== 'approved' && x.decision !== 'rejected') || typeof x.decided_at !== 'string') throw new Error('INVALID_APPROVAL_ROWS');
    return { id: x.id, concept: x.concept, claims_version: x.claims_version, requirement_sha256: x.requirement_sha256,
      reviewer_id: x.reviewer_id, decision: x.decision, decided_at: x.decided_at };
  });
}
export function mapReviewers(json: unknown): string[] {
  const rows = array(json, 'INVALID_REVIEWER_ROWS');
  if (!rows.every(r => typeof r === 'string' && UUID.test(r))) throw new Error('INVALID_REVIEWER_ROWS');
  return rows as string[];
}
export function mapDiffInputs(json: unknown): { runs: DiffRun[]; focus: DiffFocus[] } {
  const x = json as { runs?: unknown; focus?: unknown } | null;
  const runs = array(x?.runs, 'INVALID_DIFF_ROWS').map(r => {
    const y = r as Record<string, unknown>;
    if (typeof y.has_assessment !== 'boolean') throw new Error('INVALID_DIFF_ROWS');
    return { has_assessment: y.has_assessment, clip_status: typeof y.clip_status === 'string' ? y.clip_status : null,
      family_reason: typeof y.family_reason === 'string' ? y.family_reason : null,
      issues: array(y.issues, 'INVALID_DIFF_ROWS').map(i => ({ concept: typeof (i as { concept?: unknown }).concept === 'string'
        ? (i as { concept: string }).concept : null, claim_decision: (i as { claim_decision?: unknown }).claim_decision ?? null })) };
  });
  const focus = array(x?.focus, 'INVALID_DIFF_ROWS').map(f => {
    const y = f as Record<string, unknown>;
    if (typeof y.concept !== 'string' || typeof y.status !== 'string') throw new Error('INVALID_DIFF_ROWS');
    return { concept: y.concept, status: y.status };
  });
  return { runs, focus };
}
