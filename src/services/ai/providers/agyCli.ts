import { analyzeSwingViaAgy, requireAgyDataConfirmation } from "../agyCliAnalyzer.ts";
import { verifyPackageDirectory } from "./claudeCli.ts";
import type { SwingReportProvider } from "./types.ts";

export function createAgyCliProvider(deps: { analyze?: typeof analyzeSwingViaAgy } = {}): SwingReportProvider {
  return { id: "agy-cli", async analyze(pkg, assets, render) {
    requireAgyDataConfirmation();
    const rendered = render(pkg);
    if (rendered.version !== "render-2.1") throw new Error("RENDER_NOT_ENABLED");
    const dir = await verifyPackageDirectory(pkg, assets, rendered.imageOrder);
    const result = await (deps.analyze ?? analyzeSwingViaAgy)(dir, pkg.analysisInput);
    return { result, model: result.aiModel ?? null, modelVersion: result.aiModelVersion ?? null,
      usage: null, usageReason: "not_captured_legacy_adapter", requestImageOrder: [...rendered.imageOrder] };
  } };
}
