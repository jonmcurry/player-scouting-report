import { assertEnforceableTuple, BASELINE_ENGINE } from "../development/evidenceRegistry.ts";

export type GateMode = "off" | "shadow" | "enforce";
export interface AnalysisFlags {
  readonly evidenceGateMode: GateMode;
  readonly reportGateMode: GateMode;
  readonly legacyRunPolicy: "show_as_before" | "legacy_safe_only";
  readonly engine: string;
}

export type AnalysisConfig = Readonly<Record<string, unknown>>;
export const ANALYSIS_FLAG_KEYS = Object.freeze([
  "EVIDENCE_GATE_MODE", "REPORT_EVIDENCE_GATE_MODE", "REPORT_LEGACY_RUN_POLICY", "ANALYSIS_ENGINE",
] as const);

function enumValue<T extends string>(config: AnalysisConfig, key: string,
  allowed: readonly T[], fallback: T): T {
  const value = Object.hasOwn(config, key) ? config[key] : undefined;
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    // Never echo config values: these could contain secrets or private paths.
    throw new Error(`Invalid analysis configuration: ${key}`);
  }
  return value as T;
}

/** Pure and unused by production in PR7. Unknown values throw, never downgrade.
 * Explicit observed tuple required for either enforce mode. No env key can supply
 * registry entries, approvals, or override the enforcement invariant.
 */
export function parseAnalysisFlags(config: AnalysisConfig = {}, tuple?: unknown): Readonly<AnalysisFlags> {
  if (config === null || typeof config !== "object" || Array.isArray(config)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(config))) {
    throw new Error("Invalid analysis configuration object");
  }
  const flags: AnalysisFlags = {
    evidenceGateMode: enumValue(config, "EVIDENCE_GATE_MODE", ["off", "shadow", "enforce"], "off"),
    reportGateMode: enumValue(config, "REPORT_EVIDENCE_GATE_MODE", ["off", "shadow", "enforce"], "off"),
    legacyRunPolicy: enumValue(config, "REPORT_LEGACY_RUN_POLICY", ["show_as_before", "legacy_safe_only"], "show_as_before"),
    engine: enumValue(config, "ANALYSIS_ENGINE", [BASELINE_ENGINE], BASELINE_ENGINE),
  };
  if (flags.evidenceGateMode === "enforce" || flags.reportGateMode === "enforce") {
    assertEnforceableTuple(tuple, flags.engine);
  }
  return Object.freeze(flags);
}

/** Callers may supply process.env[key] or Deno.env.get(key); no global/env reads
 * on import, and only the same four keys are read in either runtime.
 */
export function readAnalysisFlags(get: (key: string) => unknown, tuple?: unknown): Readonly<AnalysisFlags> {
  return parseAnalysisFlags(Object.fromEntries(ANALYSIS_FLAG_KEYS.map(key => [key, get(key)])), tuple);
}
