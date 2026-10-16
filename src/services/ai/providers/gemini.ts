import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { analyzeSwing, type FrameImage } from "../geminiAnalyzer.ts";
import { requirePaidGeminiService } from "../geminiDataTerms.ts";
import type { SwingReportProvider } from "./types.ts";

export function createGeminiProvider(deps: { analyze?: typeof analyzeSwing; analyzeDeps?: Parameters<typeof analyzeSwing>[2] } = {}): SwingReportProvider {
  return { id: "gemini", async analyze(pkg, assets, render) {
    requirePaidGeminiService(process.env.GEMINI_PAID_SERVICE_CONFIRMED);
    const rendered = render(pkg);
    if (rendered.version !== "render-2.1") throw new Error("RENDER_NOT_ENABLED");
    const frames: FrameImage[] = [];
    for (const name of rendered.imageOrder) {
      const image = pkg.images.find(image => image.name === name), file = assets.get(name);
      if (!image || !file) throw new Error(`ASSET_HASH_MISMATCH:${name}`);
      let data: Buffer;
      try {
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`ASSET_HASH_MISMATCH:${name}`);
        data = await readFile(file);
      } catch { throw new Error(`ASSET_HASH_MISMATCH:${name}`); }
      if (createHash("sha256").update(data).digest("hex") !== image.sha256) throw new Error(`ASSET_HASH_MISMATCH:${name}`);
      frames.push({ data, mimeType: image.mimeType });
    }
    const result = await (deps.analyze ?? analyzeSwing)(frames, pkg.analysisInput, deps.analyzeDeps);
    return { result, model: result.aiModel ?? null, modelVersion: result.aiModelVersion ?? null,
      usage: null, usageReason: "not_captured_legacy_adapter", requestImageOrder: [...rendered.imageOrder] };
  } };
}
