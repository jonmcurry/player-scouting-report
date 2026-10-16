import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { analyzeSwingViaClaudeCli, requireClaudeDataConfirmation } from "../claudeCliAnalyzer.ts";
import type { EvidencePackage, PackageAssets } from "../evidencePackage.ts";
import type { SwingReportProvider } from "./types.ts";

/** Shared CLI preflight. The caller must run its own account gate FIRST.
 * Legacy CLIs reopen files: the owner must keep this directory stable through completion. */
export async function verifyPackageDirectory(pkg: EvidencePackage, assets: PackageAssets, imageOrder: string[]): Promise<string> {
  const mismatch = () => new Error("PACKAGE_DIRECTORY_MISMATCH");
  try {
    const dirs = new Set([...assets.values()].map(file => path.dirname(file)));
    if (dirs.size !== 1 || assets.size !== pkg.images.length) throw mismatch();
    const dir = [...dirs][0]!;
    if (!path.isAbsolute(dir)) throw mismatch();
    const names = (await readdir(dir)).filter(name => [".png", ".jpg", ".jpeg"].includes(path.extname(name).toLowerCase())).sort();
    if (names.length !== imageOrder.length || names.some((name, i) => name !== imageOrder[i])) throw mismatch();
    for (const name of names) {
      const file = assets.get(name), image = pkg.images.find(image => image.name === name);
      if (!file || !image || file !== path.join(dir, name)) throw mismatch();
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw mismatch();
      if (createHash("sha256").update(await readFile(file)).digest("hex") !== image.sha256) throw mismatch();
    }
    return dir;
  } catch { throw mismatch(); }
}

export function createClaudeCliProvider(deps: { analyze?: typeof analyzeSwingViaClaudeCli } = {}): SwingReportProvider {
  return { id: "claude-cli", async analyze(pkg, assets, render) {
    requireClaudeDataConfirmation();
    const rendered = render(pkg);
    if (rendered.version !== "render-2.1") throw new Error("RENDER_NOT_ENABLED");
    const dir = await verifyPackageDirectory(pkg, assets, rendered.imageOrder);
    const result = await (deps.analyze ?? analyzeSwingViaClaudeCli)(dir, pkg.analysisInput);
    return { result, model: result.aiModel ?? null, modelVersion: result.aiModelVersion ?? null,
      usage: null, usageReason: "not_captured_legacy_adapter", requestImageOrder: [...rendered.imageOrder] };
  } };
}
