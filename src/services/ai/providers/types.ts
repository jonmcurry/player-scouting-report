import type { EvidencePackage, PackageAssets } from "../evidencePackage.ts";
import type { PromptRenderer } from "../renderers.ts";
import type { SwingAnalysisResult } from "../swingAnalysisShared.ts";

export interface SwingReportProvider {
  readonly id: string;
  analyze(pkg: EvidencePackage, assets: PackageAssets, render: PromptRenderer): Promise<ProviderResult>;
}
export interface ProviderResult {
  result: SwingAnalysisResult; model: string | null; modelVersion: string | null;
  usage: null; usageReason: "not_captured_legacy_adapter"; requestImageOrder: string[];
}
