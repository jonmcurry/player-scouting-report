/** Phase 5 comparison rules. Numeric results are admitted only after a human
 * validated definition supplies explicit sample limits. No universal score. */
export type Exclusion = "wrong_athlete" | "sport_mismatch" | "intent_mismatch" |
  "environment_mismatch" | "incompatible_capture" | "insufficient_quality" |
  "definition_version_mismatch" | "missing_result" | "coach_excluded";

export interface ComparisonInput {
  attemptId: string; clipId: string; playerId: string; date: string;
  sport: string; intent: string; environment: string; sessionType: "game" | "practice";
  profile: string | null; profileVersion: string | null; orientation: string | null;
  captureState: string | null; assessmentStage: string | null; qualityClear: boolean;
  visiblePhases: string[]; resultDefinitionId: string | null;
  sourcePackageId: string | null; value: number | null; visible: boolean;
  sourceRevision: string | null;
}
export interface ComparisonDefinition {
  id: string; version: string; status: string; sports: string[]; intents: string[];
  profiles: string[]; aggregateMinSample: number | null; trendMinSample: number | null;
  trendThreshold: number | null; requiredPhases: string[];
}
export interface Member { attemptId: string; clipId: string; date: string; reason: Exclusion | null;
  value: number | null; sourcePackageId: string | null; sourceRevision: string | null }
export interface Distribution { count: number; excludedCount: number; from: string; through: string;
  median: number; q1: number; q3: number; iqr: number }

export function exclusion(reference: ComparisonInput, candidate: ComparisonInput,
  definition: ComparisonDefinition, omitted = false): Exclusion | null {
  if (candidate.playerId !== reference.playerId) return "wrong_athlete";
  if (!definition.sports.includes(reference.sport) || candidate.sport !== reference.sport) return "sport_mismatch";
  if (reference.intent === "unknown" || !definition.intents.includes(reference.intent)
    || candidate.intent !== reference.intent) return "intent_mismatch";
  if (reference.environment === "unknown" || candidate.environment !== reference.environment
    || candidate.sessionType !== reference.sessionType) return "environment_mismatch";
  if (!reference.profile || reference.profile === "unknown_imported"
    || !reference.profileVersion || !reference.orientation || reference.orientation === "unknown"
    || reference.captureState !== "supported" || reference.assessmentStage !== "full"
    || candidate.profile !== reference.profile
    || candidate.profileVersion !== reference.profileVersion || candidate.orientation !== reference.orientation
    || candidate.captureState !== "supported" || candidate.assessmentStage !== "full"
    || !definition.profiles.includes(reference.profile))
    return "incompatible_capture";
  if (candidate.resultDefinitionId && candidate.resultDefinitionId !== definition.id)
    return "definition_version_mismatch";
  if (candidate.resultDefinitionId !== definition.id || !candidate.sourcePackageId
    || candidate.value === null || !Number.isFinite(candidate.value)) return "missing_result";
  if (!candidate.visible || !candidate.qualityClear
    || !definition.requiredPhases.every((phase) => candidate.visiblePhases.includes(phase)))
    return "insufficient_quality";
  if (omitted) return "coach_excluded";
  return null;
}

export function buildMembers(reference: ComparisonInput, candidates: ComparisonInput[],
  definition: ComparisonDefinition, omitted: ReadonlySet<string> = new Set()): Member[] {
  return candidates.map((candidate) => {
    const reason = exclusion(reference, candidate, definition, omitted.has(candidate.attemptId));
    return { attemptId: candidate.attemptId, clipId: candidate.clipId, date: candidate.date, reason,
      value: reason ? null : candidate.value, sourcePackageId: reason ? null : candidate.sourcePackageId,
      sourceRevision: candidate.sourceRevision };
  });
}

function quantile(sorted: number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

export function distribution(members: Member[], definition: ComparisonDefinition): Distribution | null {
  if (!["validated_internal", "validated_external"].includes(definition.status)
    || !Number.isInteger(definition.aggregateMinSample) || (definition.aggregateMinSample ?? 0) < 5) return null;
  const included = members.filter((member) => member.reason === null && member.value !== null
    && Number.isFinite(member.value));
  if (included.length < definition.aggregateMinSample!) return null;
  const values = included.map((member) => member.value!).sort((a, b) => a - b);
  const dates = included.map((member) => member.date).sort();
  const q1 = quantile(values, .25), q3 = quantile(values, .75);
  return { count: included.length, excludedCount: members.length - included.length,
    from: dates[0]!, through: dates.at(-1)!, median: quantile(values, .5), q1, q3, iqr: q3 - q1 };
}

/** Trend language is unavailable until a reviewed, per-definition magnitude
 * rule exists. Identical compatibility keys and two adequate windows are mandatory. */
export function trend(previous: Distribution | null, current: Distribution | null,
  previousKey: string, currentKey: string, definition: ComparisonDefinition): "higher" | "lower" | null {
  const threshold = definition.trendThreshold;
  if (!previous || !current || previousKey !== currentKey || !Number.isInteger(definition.trendMinSample)
    || (definition.trendMinSample ?? 0) < 10 || previous.count < definition.trendMinSample!
    || current.count < definition.trendMinSample! || threshold === null || !Number.isFinite(threshold)
    || threshold <= 0) return null;
  const change = current.median - previous.median;
  return Math.abs(change) >= threshold ? change > 0 ? "higher" : "lower" : null;
}
