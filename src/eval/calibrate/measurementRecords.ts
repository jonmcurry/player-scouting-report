import { CLAIM_REQUIREMENTS } from '../../services/development/evidence/claimRequirements.ts';
import type { ReliabilityProfile } from '../../services/development/evidence/reliability.ts';
import type { ClipAnnotation } from '../schema/annotation.ts';
import { verifyProfile } from './reliabilityProfile.ts';

/** File payloads only. The profile schema version (currently 1.2.0) deterministically maps to the definition version.
 * A human must supply reviewer IDs before any separate persistence workflow. */
export function measurementRecords(profile: ReliabilityProfile, annotations: ClipAnnotation[]) {
  verifyProfile(profile);
  if (!annotations.length || annotations.some(a => !['baseball', 'softball'].includes(a.sport))) throw new Error('SPORT_UNAVAILABLE');
  return { requires_human_reviewer_ids_at_persistence: true, records: profile.entries.map(entry => {
    const relevant = annotations.filter(a => a.camera.capture_profile === entry.capture_profile);
    if (!relevant.length) throw new Error('CAPTURE_PROFILE_ANNOTATIONS_UNAVAILABLE');
    // 00055 enforces unique (slug, version): one definition per concept AND capture profile.
    const slug = `reliability_${entry.concept}_${entry.capture_profile}`;
    if (!/^[a-z][a-z0-9_]*$/.test(slug)) throw new Error('INVALID_MEASUREMENT_SLUG');
    const intents = [...new Set(relevant.flatMap(a => a.swings.map(s => s.intent)))].sort();
    return {
      measurement_definition: {
        slug, version: profile.schema_version, display_name: `Claim reliability: ${entry.concept} (${entry.capture_profile})`,
        plain_definition: 'Unsafe measurable V1/V2/V3 claim passes divided by measurable claim passes, per concept and capture profile.',
        source_class: 'video_estimated', sports: [...new Set(relevant.map(a => a.sport))].sort(), intents: intents.length ? intents : ['unknown'],
        capture_profiles: [entry.capture_profile], required_phases: [...new Set(CLAIM_REQUIREMENTS[entry.concept].events.flat())],
        minimum_quality: {}, unit: 'fraction', compatibility_rules: { tuple: profile.tuple, profile_version: profile.version },
        aggregate_min_sample: null,
        uncertainty_method: `athlete-cluster percentile bootstrap, 2000 replicates, seed ${profile.provenance.seed}; cluster-adjusted rule of three when zero unsafe`,
        visibility: [], limitations: 'Experimental validation-only population estimate. Unmeasurable evidence is excluded and counted. Proposed requirements; provisional D8 ceiling. Not registered; no sealed test; not a per-clip guarantee.',
        prohibited_interpretations: ['not production acceptance', 'not per-clip accuracy', 'engine confidence is not reliability'], created_by: null,
      },
      validation_decision: { status: 'experimental', rationale: `Offline validation: ${entry.status}; ${entry.reason ?? 'D8 provisional ceiling'}. Not production acceptance; not registered.`, decided_by: null },
    };
  }) };
}
