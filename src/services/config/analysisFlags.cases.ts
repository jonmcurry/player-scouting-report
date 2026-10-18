import { PIPELINE_VERSION } from "../reconstruction/types.ts";
// Shared synthetic acceptance table for Node and Deno; no runtime globals.
import { BASELINE_ENGINE } from "../development/evidenceRegistry.ts";
import type { AnalysisConfig, AnalysisFlags } from "./analysisFlags.ts";

const defaults: AnalysisFlags = {
  evidenceGateMode: "off", reportGateMode: "off",
  legacyRunPolicy: "show_as_before", engine: BASELINE_ENGINE,
};
export const flagCases: readonly {
  name: string; config: AnalysisConfig; expected: AnalysisFlags | null;
}[] = [
  { name: "defaults", config: {}, expected: defaults },
  { name: "explicit defaults", config: { EVIDENCE_GATE_MODE: "off", REPORT_EVIDENCE_GATE_MODE: "off",
    REPORT_LEGACY_RUN_POLICY: "show_as_before", ANALYSIS_ENGINE: BASELINE_ENGINE }, expected: defaults },
  { name: "undefined", config: { EVIDENCE_GATE_MODE: undefined }, expected: defaults },
  { name: "unrelated environment", config: { PATH: "not-read" }, expected: defaults },
  { name: "worker shadow", config: { EVIDENCE_GATE_MODE: "shadow" }, expected: { ...defaults, evidenceGateMode: "shadow" } },
  { name: "report shadow", config: { REPORT_EVIDENCE_GATE_MODE: "shadow" }, expected: { ...defaults, reportGateMode: "shadow" } },
  { name: "legacy safe", config: { REPORT_LEGACY_RUN_POLICY: "legacy_safe_only" }, expected: { ...defaults, legacyRunPolicy: "legacy_safe_only" } },
  ...["EVIDENCE_GATE_MODE", "REPORT_EVIDENCE_GATE_MODE"].flatMap(key => [
    { name: `${key} enforce rejected`, config: { [key]: "enforce" }, expected: null },
    ...["", "OFF", " off", "off\n", "true", false, null, 0, {}, ["off"]].map(value => ({
      name: `${key} rejects ${JSON.stringify(value)}`, config: { [key]: value }, expected: null,
    })),
  ]),
  ...["pose3d-live-1.0.0", PIPELINE_VERSION, "engine-baseline-9.0.0", "", null].map(value => ({
    name: `unknown engine ${value}`, config: { ANALYSIS_ENGINE: value }, expected: null,
  })),
  ...["", "safe", "SHOW_AS_BEFORE", false, null].map(value => ({
    name: `invalid legacy policy ${value}`, config: { REPORT_LEGACY_RUN_POLICY: value }, expected: null,
  })),
];
