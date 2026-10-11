import { getSupabaseClient } from "./supabaseClient.js";
import { methodologyAvailability, type AttemptContext } from "../analysisDepth/attemptModel.js";

/** Service-only eligibility read. Always uses the latest append-only context. */
export async function attemptMethodologyAvailability(attemptId: string, definitionId: string) {
  const db = getSupabaseClient();
  const [activeResult, contextResult, definitionResult, decisionResult] = await Promise.all([
    db.from("active_legacy_swing_attempts").select("id").eq("id", attemptId).maybeSingle(),
    db.from("swing_attempt_context_history").select("sport,environment,intent,revision")
      .eq("swing_attempt_id", attemptId).order("revision", { ascending: false }).limit(1).maybeSingle(),
    db.from("measurement_definitions").select("sports,intents,compatibility_rules").eq("id", definitionId).maybeSingle(),
    db.from("measurement_validation_decisions").select("status").eq("definition_id", definitionId)
      .order("decided_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (activeResult.error || contextResult.error || definitionResult.error || decisionResult.error)
    throw new Error("Attempt methodology lookup failed");
  if (!activeResult.data) return { available: false, reasons: ["attempt_inactive"], contextRevision: null };
  const context = contextResult.data as (AttemptContext & { revision: number }) | null;
  const definition = definitionResult.data;
  if (!context || !definition) return { available: false, reasons: ["context_or_definition_unavailable"], contextRevision: null };
  const rules = definition.compatibility_rules as Record<string, unknown> | null;
  const hasEnvironmentRule = Object.hasOwn(rules ?? {}, "environments");
  const environmentRuleValid = !hasEnvironmentRule || Array.isArray(rules?.environments)
    && rules.environments.length > 0
    && rules.environments.every((value: unknown) => typeof value === "string");
  if (!environmentRuleValid) return { available: false, reasons: ["invalid_environment_rule"],
    contextRevision: context.revision };
  const environments = hasEnvironmentRule ? rules!.environments as string[] : undefined;
  const result = methodologyAvailability({ status: decisionResult.data?.status ?? "experimental",
    sports: definition.sports ?? [], intents: definition.intents ?? [], environments }, context);
  return { ...result, contextRevision: context.revision };
}
