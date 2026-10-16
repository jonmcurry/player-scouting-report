import type { EvidencePackage } from "./evidencePackage.ts";
import { renderSwingAnalysisPrompt } from "./swingAnalysisShared.ts";

export type PromptRenderer = (pkg: EvidencePackage) => {
  version: string; text: string; imageOrder: string[]; labels: Record<string, string> | null;
};
export const render21: PromptRenderer = pkg => ({
  version: "render-2.1", text: renderSwingAnalysisPrompt(pkg.analysisInput),
  imageOrder: pkg.images.map(image => image.name).sort(), labels: null,
});
/** Prepared only: adapters reject this version until separately approved wiring. */
export const render22: PromptRenderer = pkg => ({
  version: "render-2.2", text: render21(pkg).text,
  imageOrder: [...pkg.images].sort((a, b) => a.orderInSwing - b.orderInSwing).map(image => image.name),
  labels: Object.fromEntries(pkg.images.map(image => [image.name,
    `${image.name} | ${image.phase ?? "null"} | ${image.identity} | ${image.identity === "verified" ? image.rawPtsS : "unverified"}`])),
});
export const RENDERERS: Readonly<Record<string, PromptRenderer>> = Object.freeze({ "render-2.1": render21, "render-2.2": render22 });
