// Deno resolves this shim's .ts imports natively; Node parity tests use tsx.
// Only src/ imports are rewritten by tsc. No Node APIs or env reads here.
export { ANALYSIS_FLAG_KEYS, parseAnalysisFlags, readAnalysisFlags } from "../../../src/services/config/analysisFlags.ts";
export type { AnalysisConfig, AnalysisFlags, GateMode } from "../../../src/services/config/analysisFlags.ts";
