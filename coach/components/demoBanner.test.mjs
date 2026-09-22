// Phase 3 demo-runtime-mode tests. demoConfig.js is pure and safe to import
// directly under plain Node (no DOM, no esm.sh import). shared.js and
// videoUpload.js pull in the esm.sh Supabase client, which - like every
// other test file in this repo - can't be imported directly under plain
// Node; their demo-mode wiring is verified via static content checks
// instead, the same style this suite already uses elsewhere for
// cross-cutting invariants (e.g. "no native confirm/alert calls").
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

let importCounter = 0;
const freshImport = (spec) => import(`${spec}?t=${crypto.randomUUID()}-${importCounter++}`);

const coach = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(coach, rel), "utf8");

test("getDemoConfig defaults to normal mode with no global set (the case for every existing page and the Android build)", async () => {
  delete globalThis.window;
  const { getDemoConfig, isDemoMode } = await freshImport("../demoConfig.js");
  assert.equal(getDemoConfig().mode, "normal");
  assert.equal(isDemoMode(), false);
  assert.equal(getDemoConfig().capabilities.uploads, true, "normal mode must not carry demo capability restrictions");
});

test("getDemoConfig ignores a global with mode !== \"demo\"", async () => {
  globalThis.window = { __HITTERLOOP_DEMO_CONFIG__: { mode: "something-else" } };
  const { getDemoConfig } = await freshImport("../demoConfig.js");
  assert.equal(getDemoConfig().mode, "normal");
  delete globalThis.window;
});

test("getDemoConfig reads mode: \"demo\" and applies safe defaults + explicit capability flags", async () => {
  globalThis.window = {
    __HITTERLOOP_DEMO_CONFIG__: {
      mode: "demo",
      supabaseUrl: "https://demo-project.supabase.co",
      supabaseAnonKey: "demo-anon-key",
    },
  };
  const { getDemoConfig, isDemoMode } = await freshImport("../demoConfig.js");
  const cfg = getDemoConfig();
  assert.equal(isDemoMode(), true);
  assert.equal(cfg.basePath, "/hitterloop/demo/");
  assert.equal(cfg.capabilities.uploads, false, "capabilities must default to false, never true, when unspecified");
  assert.equal(cfg.capabilities.liveAnalysis, false);
  assert.equal(cfg.returnUrl, "https://joncurry.co/projects/hitterloop");
  delete globalThis.window;
});

test("getDemoConfig refuses demo mode with no supabaseUrl/supabaseAnonKey rather than silently falling back", async () => {
  globalThis.window = { __HITTERLOOP_DEMO_CONFIG__: { mode: "demo" } };
  const mod = await freshImport("../demoConfig.js");
  assert.throws(() => mod.getDemoConfig(), /supabaseUrl\/supabaseAnonKey/);
  delete globalThis.window;
});

test("demoConfig.js never hardcodes a production or local-dev Supabase URL", () => {
  const src = read("demoConfig.js");
  assert.doesNotMatch(src, /127\.0\.0\.1|localhost|supabase\.co\/[a-z0-9-]+prod/i);
});

test("shared.js: demo mode skips the normal login redirect and bootstraps anonymously instead", () => {
  const src = read("shared.js");
  assert.match(src, /isDemoMode\(\)/, "requireSession must branch on the centralized isDemoMode() check");
  assert.match(src, /signInAnonymously/, "demo bootstrap must use Supabase anonymous auth");
  assert.match(src, /rpc\(["']start_demo_session["']\)/, "demo bootstrap must call start_demo_session()");
});

test("shared.js: demo banner is injected unconditionally at module load (so it also reaches report.html)", () => {
  const src = read("shared.js");
  assert.match(src, /if \(isDemoMode\(\)\) \{\s*\n\s*injectDemoBanner\(\);/);
  assert.match(src, /Demo — fictional players and data/);
  assert.match(src, /rpc\(["']reset_demo_session["']\)/, "the banner's Reset action must call reset_demo_session()");
});

test("videoUpload.js: uploadRawClip refuses to run when capabilities.uploads is false, before any network call", () => {
  const src = read("components/videoUpload.js");
  const guardIndex = src.indexOf("capabilities.uploads");
  const invokeIndex = src.indexOf('functions.invoke("get-upload-url"');
  assert.ok(guardIndex > -1, "uploadRawClip must check capabilities.uploads");
  assert.ok(invokeIndex > -1, "sanity check: the actual get-upload-url call must still be present");
  assert.ok(guardIndex < invokeIndex, "the capability check must come before the actual get-upload-url network call, not after");
});

test("every coach/*.html page loads the optional demo.local.js override before config.local.js, inert if absent", () => {
  const pages = fs.readdirSync(coach).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length > 0);
  for (const page of pages) {
    const html = read(page);
    if (!html.includes("config.local.js")) continue; // pages without the local-override boundary at all are unaffected
    assert.match(html, /<script src="\.\/demo\.local\.js"><\/script><script src="\.\/config\.local\.js">/, `${page} must load demo.local.js before config.local.js`);
  }
});

test("coach/demo.local.example.js never sets uploads/liveAnalysis to true", () => {
  const src = read("demo.local.example.js");
  assert.match(src, /uploads:\s*false/);
  assert.match(src, /liveAnalysis:\s*false/);
});
