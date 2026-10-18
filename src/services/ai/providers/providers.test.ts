import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import type { GoogleGenAI } from "@google/genai";
import ts from "typescript";
import { buildEvidencePackage } from "../evidencePackage.ts";
import { render21, render22 } from "../renderers.ts";
import { analyzeSwing } from "../geminiAnalyzer.ts";
import { createGeminiProvider } from "./gemini.ts";
import { createClaudeCliProvider } from "./claudeCli.ts";
import { createAgyCliProvider } from "./agyCli.ts";
import type { AnalysisInput } from "../analysisContext.ts";
import type { SwingAnalysisResult } from "../swingAnalysisShared.ts";

const dirs: string[] = [];
const envKeys = ["GEMINI_MODEL", "GEMINI_PAID_SERVICE_CONFIRMED", "CLAUDE_CLI_DATA_CONFIRMED", "AGY_ANALYZER_DATA_CONFIRMED"];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
test.afterEach(() => { for (const key of envKeys) {
  if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
} });
test.after(async () => { for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true }); });
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0, 1]);
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pr12-providers-")); dirs.push(dir);
  const names = ["z.png", "A.JPEG", "a.jpg"];
  for (const name of names) await fs.writeFile(path.join(dir, name), name.endsWith(".png") ? png : jpeg);
  const input: AnalysisInput = {
    player: { sport: "softball", level: null, ageBand: null, bats: null, throws: null },
    pitch: { location: null, zone: null, count: null, outcome: null, swung: null, pitchType: null },
    swing: { frameNames: names, pipelineVersion: "pose3d-live-1.0.0", metrics: {}, reconstructionSupplied: false, excludedMeasurements: [] },
    coachReviewedDecisions: [], knowledgePack: "No approved claims.", knowledgeClaimIds: [], knowledgeVersion: "synthetic",
  };
  const built = await buildEvidencePackage({ videoClipId: "synthetic", sourceSha256: "2".repeat(64), imagesDir: dir,
    images: names.map((name, i) => ({ name, kind: "swing_sequence", phase: null, analysisFrame: null, assumed: { rawFrame: null, rawPtsS: i } })),
    metrics: { pipeline_version: "pose3d-live-1.0.0" }, analysisInput: input });
  assert.ok(built.ok, JSON.stringify(built));
  return { ...built, dir, input };
}
const response = { noActionNeeded: true, noActionReason: "Insufficient detail.", summary: "The batter is too small to assess.", strengths: [], issues: [] };
const fakeResult: SwingAnalysisResult = { ...response, checklist: [], comps: [], compNotes: [], drills: [], source: "gemini", aiModel: "synthetic", aiModelVersion: "synthetic-v1" };
test("GEMINI GOLDEN: legacy load order, model, text, base64 and config are identical", async () => {
  const { pkg, assets, dir, input } = await fixture();
  process.env.GEMINI_MODEL = "synthetic-model"; process.env.GEMINI_PAID_SERVICE_CONFIRMED = "true";
  const captured: unknown[] = [];
  const client = { models: { generateContent: async (args: unknown) => {
    captured.push(args); return { text: JSON.stringify(response), modelVersion: "synthetic-v1" };
  } } } as unknown as Pick<GoogleGenAI, "models">;
  const provider = createGeminiProvider({ analyzeDeps: { client } });
  const result = await provider.analyze(pkg, assets, render21);
  assert.equal(captured.length, 1);
  const files = (await fs.readdir(dir)).filter(name => [".png", ".jpg", ".jpeg"].includes(path.extname(name).toLowerCase())).sort();
  const frames = await Promise.all(files.map(async name => ({ data: await fs.readFile(path.join(dir, name)),
    mimeType: path.extname(name).toLowerCase() === ".png" ? "image/png" : "image/jpeg" })));
  const legacy = await analyzeSwing(frames, input, { client });
  assert.equal(captured.length, 2); assert.deepEqual(captured[0], captured[1]);
  assert.deepEqual(result.result, legacy); assert.deepEqual(result.requestImageOrder, files);
  assert.equal(result.model, "synthetic-model"); assert.equal(result.modelVersion, "synthetic-v1");
  assert.equal(result.usage, null); assert.equal(result.usageReason, "not_captured_legacy_adapter");
});
test("Gemini rejects changed assets and render22 before calling backend", async () => {
  process.env.GEMINI_PAID_SERVICE_CONFIRMED = "true";
  const { pkg, assets, dir } = await fixture(); let calls = 0;
  const provider = createGeminiProvider({ analyze: async () => { calls++; return fakeResult; } });
  await assert.rejects(provider.analyze(pkg, assets, render22), /RENDER_NOT_ENABLED/);
  await fs.writeFile(path.join(dir, "z.png"), Buffer.concat([png, Buffer.from([3])]));
  await assert.rejects(provider.analyze(pkg, assets, render21), /ASSET_HASH_MISMATCH:z.png/);
  assert.equal(calls, 0);
});
test("Gemini reads only rendered images", async () => {
  process.env.GEMINI_PAID_SERVICE_CONFIRMED = "true";
  const { pkg, assets, dir } = await fixture(); let calls = 0;
  await fs.rm(path.join(dir, "z.png"));
  const provider = createGeminiProvider({ analyze: async frames => {
    calls++; assert.equal(frames.length, 1); assert.deepEqual(frames[0]!.data, jpeg); return fakeResult;
  } });
  const result = await provider.analyze(pkg, assets, p => ({ ...render21(p), imageOrder: ["a.jpg"] }));
  assert.equal(calls, 1); assert.deepEqual(result.requestImageOrder, ["a.jpg"]);
});
test("Gemini consent is first, before render, asset access or backend", async () => {
  const { pkg, assets, dir } = await fixture();
  delete process.env.GEMINI_PAID_SERVICE_CONFIRMED;
  const missingAssets = new Map([...assets.keys()].map(name => [name, path.join(dir, "missing", name)]));
  let calls = 0, renders = 0;
  const provider = createGeminiProvider({ analyze: async () => { calls++; return fakeResult; } });
  await assert.rejects(provider.analyze(pkg, missingAssets, p => { renders++; return render21(p); }), {
    message: "Gemini child-data processing is disabled until paid-service data terms are explicitly confirmed",
  });
  assert.equal(calls, 0);
  assert.equal(renders, 0);
});

test("Gemini rejects symlinked assets with zero backend calls", async t => {
  const { pkg, assets, dir } = await fixture();
  process.env.GEMINI_PAID_SERVICE_CONFIRMED = "true";
  const link = path.join(dir, "linked.png");
  try {
    await fs.symlink(path.join(dir, "z.png"), link, "file");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EACCES")) {
      t.skip(`Windows does not permit symlink creation (${code})`);
      return;
    }
    throw error;
  }
  assets.set("z.png", link);
  let calls = 0;
  const provider = createGeminiProvider({ analyze: async () => { calls++; return fakeResult; } });
  await assert.rejects(provider.analyze(pkg, assets, render21), { message: "ASSET_HASH_MISMATCH:z.png" });
  assert.equal(calls, 0);
});

for (const [label, env, factory] of [
  ["Claude", "CLAUDE_CLI_DATA_CONFIRMED", createClaudeCliProvider],
  ["AGY", "AGY_ANALYZER_DATA_CONFIRMED", createAgyCliProvider],
] as const) {
  test(`${label} consent is first, before render, filesystem access or backend`, async t => {
    const { pkg, assets } = await fixture(); delete process.env[env]; let calls = 0, renders = 0;
    const reads = t.mock.method(fs, "readdir", async () => { throw new Error("unexpected read"); });
    const stats = t.mock.method(fs, "lstat", async () => { throw new Error("unexpected read"); });
    const bytes = t.mock.method(fs, "readFile", async () => { throw new Error("unexpected read"); });
    const provider = factory({ analyze: async () => { calls++; return fakeResult; } });
    syncBuiltinESMExports();
    try {
      await assert.rejects(provider.analyze(pkg, assets, p => { renders++; return render21(p); }), new RegExp(env));
      assert.equal(reads.mock.callCount() + stats.mock.callCount() + bytes.mock.callCount(), 0);
      assert.equal(calls, 0); assert.equal(renders, 0);
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  });
  test(`${label} matching directory calls backend exactly once, with only dir and unchanged input`, async () => {
    const { pkg, assets, dir } = await fixture(); process.env[env] = "true";
    const calls: unknown[][] = [];
    const provider = factory({ analyze: async (...args) => { calls.push(args); return fakeResult; } });
    const result = await provider.analyze(pkg, assets, render21);
    assert.deepEqual(calls, [[dir, pkg.analysisInput]]);
    assert.deepEqual(result.requestImageOrder, render21(pkg).imageOrder);
    assert.equal(result.usageReason, "not_captured_legacy_adapter");
  });
  for (const change of ["extra", "missing", "changed", "mixed-directories", "render22"] as const) {
    test(`${label} rejects ${change} with zero backend calls`, async () => {
      const { pkg, assets, dir } = await fixture(); process.env[env] = "true"; let calls = 0;
      const provider = factory({ analyze: async () => { calls++; return fakeResult; } });
      if (change === "extra") await fs.writeFile(path.join(dir, "extra.png"), png);
      if (change === "missing") await fs.rm(path.join(dir, "z.png"));
      if (change === "changed") await fs.writeFile(path.join(dir, "z.png"), jpeg);
      if (change === "mixed-directories") assets.set("z.png", path.join(dir, "other", "z.png"));
      await assert.rejects(provider.analyze(pkg, assets, change === "render22" ? render22 : render21),
        change === "render22" ? /RENDER_NOT_ENABLED/ : /PACKAGE_DIRECTORY_MISMATCH/);
      assert.equal(calls, 0);
    });
  }
}
test("NO-ACTIVATION: only shadow evidence-package importer and no render-version environment selector", async () => {
  const newFiles = new Set(["services/ai/evidencePackage.ts", "services/ai/renderers.ts",
    ...["types", "gemini", "claudeCli", "agyCli"].map(name => `services/ai/providers/${name}.ts`)]);
  const forbidden: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      const relative = path.relative("src", file).replaceAll("\\", "/"), text = await fs.readFile(file, "utf8");
      // Existing analysisVersions exports a constant of this name; only environment selection is prohibited.
      assert.doesNotMatch(text, /(?:process\s*\.\s*env|Deno\s*\.\s*env)[^;\n]*PROMPT_RENDER_VERSION|PROMPT_RENDER_VERSION[^;\n]*=\s*process\s*\.\s*env/, relative);
      if (newFiles.has(relative)) continue;
      const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      function inspect(node: ts.Node): void {
        if (ts.isStringLiteralLike(node) && /(?:^|\/)(?:evidencePackage|renderers)(?:\.[cm]?ts|\.js)?$|(?:^|\/)providers\//.test(node.text)) {
          const shadowPackageImport = relative === "cli/evidenceShadow.ts"
            && node.text === "../services/ai/evidencePackage.js";
          if (!shadowPackageImport) forbidden.push(relative);
        }
        ts.forEachChild(node, inspect);
      }
      inspect(ast);
    }
  }
  await visit("src"); assert.deepEqual(forbidden, []);
  const shadowSource = await fs.readFile("src/cli/evidenceShadow.ts", "utf8");
  const parsedMode = shadowSource.search(/mode\s*=\s*readAnalysisFlags\([^;]+\)\.evidenceGateMode\s*;/);
  const shadowGuard = shadowSource.search(/if\s*\(mode\s*!==\s*"shadow"\)\s*return\s+null\s*;/);
  const firstPackageCall = shadowSource.search(/\bbuildEvidencePackage\s*\(/);
  assert.ok(parsedMode >= 0 && shadowGuard > parsedMode && firstPackageCall > shadowGuard,
    "Shadow worker must return null unless the parsed evidence gate mode is shadow before building a package");
});
