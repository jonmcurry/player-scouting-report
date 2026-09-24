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
  assert.equal(getDemoConfig().dataNamespace, "public", "normal mode must resolve against the real public schema");
});

test("getDemoConfig always forces dataNamespace to \"demo\" in demo mode, even if a raw config tried to override it", async () => {
  globalThis.window = {
    __HITTERLOOP_DEMO_CONFIG__: {
      mode: "demo",
      supabaseUrl: "https://demo-project.supabase.co",
      supabaseAnonKey: "demo-anon-key",
      dataNamespace: "public",
    },
  };
  const { getDemoConfig } = await freshImport("../demoConfig.js");
  assert.equal(getDemoConfig().dataNamespace, "demo", "dataNamespace must never be settable to \"public\" from raw config - that would point demo traffic at real production data");
  delete globalThis.window;
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
  assert.match(src, /Demo mode/);
  assert.match(src, /changes reset/);
  assert.match(src, />Reset</);
  assert.match(src, />Exit</);
  assert.doesNotMatch(src, /fictional/i, "the demo now shows real, permission-approved footage - the banner must not call it fictional");
  assert.match(src, /rpc\(["']reset_demo_session["']\)/, "the banner's Reset action must call reset_demo_session()");
});

test("demo banner is one compact row on desktop and on phones", () => {
  const css = read("coach.css");
  assert.match(css, /\.bt-demo-bar\{[^}]*min-height:32px[^}]*padding:3px 10px/);
  assert.doesNotMatch(css, /\.bt-demo-bar>span\{flex-basis:100%/, "the label must not be forced onto its own row on phones");
  assert.match(css, /\.bt-demo-bar button,\.bt-demo-bar a\{min-height:28px/, "Reset/Exit must not inherit the 44px app tap-target height");
});

test("shared.js: the Supabase client is constructed with db.schema bound to the centralized dataNamespace, never a hardcoded schema", () => {
  const src = read("shared.js");
  assert.match(src, /db:\s*\{\s*schema:\s*getDemoConfig\(\)\.dataNamespace\s*\}/, "the client's schema must come from getDemoConfig().dataNamespace, not be hardcoded, so demo mode can never accidentally resolve against public");
});

test("atbat.html: chooseVideo() (the sole chokepoint for Record pitch / camera icon / Add another video) never opens the OS picker when capabilities.uploads is false", () => {
  const src = read("atbat.html");
  const fnStart = src.indexOf("function chooseVideo(");
  const fnBody = src.slice(fnStart, src.indexOf("\n}", fnStart));
  assert.match(fnBody, /getDemoConfig\(\)\.capabilities\.uploads/, "chooseVideo must check the centralized capability flag");
  const guardIndex = fnBody.indexOf("capabilities.uploads");
  const clickIndex = fnBody.indexOf("input.click()");
  assert.ok(guardIndex > -1 && clickIndex > -1 && guardIndex < clickIndex, "the capability check must come before input.click(), not after");
  assert.match(src, /class="bt-icon-button upload-control" data-action="camera"/, "the per-pitch camera icon must carry .upload-control so demo mode's existing CSS hiding covers it");
  assert.match(src, /className: "upload-control", attrs: 'id="recordPitch"'/, "the Record pitch button must carry .upload-control");
  assert.match(src, /getDemoConfig\(\)\.capabilities\.uploads \? \[\{ label: "Add another video"/, "the overflow menu must exclude Add another video entirely in demo mode, not just gate it after opening");
});

test("practicePage.js: attachVideo/addRepsWithVideo (the practice-page file-picker chokepoints) never open the OS picker when capabilities.uploads is false", () => {
  const src = read("components/practicePage.js");
  for (const fnName of ["attachVideo", "addRepsWithVideo"]) {
    const fnStart = src.indexOf(`function ${fnName}(`);
    assert.ok(fnStart > -1, `${fnName} must exist`);
    const fnBody = src.slice(fnStart, src.indexOf("\n}", fnStart));
    const guardIndex = fnBody.indexOf("capabilities.uploads");
    const clickIndex = fnBody.indexOf("input.click()");
    assert.ok(guardIndex > -1 && clickIndex > -1 && guardIndex < clickIndex, `${fnName} must check capabilities.uploads before input.click()`);
  }
  assert.match(src, /upload-control" id="quickAddRep"/, "quickAddRep must carry .upload-control");
  assert.match(src, /upload-control" id="addRepVideo"/, "addRepVideo must carry .upload-control");
  assert.match(src, /upload-control" data-rep-action="attach"/, "the per-rep attach-video button must carry .upload-control");
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

test("devUi.js: demo playback resolves ONLY curated static media under the demo base path, never get-video-url", () => {
  const src = read("components/devUi.js");
  const demoBranch = src.slice(src.indexOf("export async function getVideoUrl"), src.indexOf("const { data } = await supabase.functions.invoke"));
  assert.match(demoBranch, /isDemoMode\(\)/);
  assert.match(demoBranch, /select\("demo_media_path, demo_media_offset_s"\)/);
  assert.doesNotMatch(demoBranch, /functions\.invoke/, "the demo branch must return before any Edge Function call");
  assert.match(src, /media\/\$\{mediaPath\}/, "media resolves under <basePath>media/");
  assert.match(src, /\^\[a-z0-9\]\[a-z0-9\._-\]\{0,120\}\\.mp4\$/, "same safe-filename rule as demo.video_clips' check constraint");
  assert.match(src, /Number\.isFinite\(offset\)/, "a clip with unknown alignment is never played with misaligned phase markers");
});

test("no page calls get-video-url directly; every phase seek applies the clip's analysis-to-video offset", () => {
  for (const page of ["player.html", "review.html", "compare.html", "atbat.html", "practice.html", "development.html"]) {
    let src = "";
    try { src = read(page); } catch { continue; }
    assert.doesNotMatch(src, /functions\.invoke\(["']get-video-url["']/, `${page} must go through devUi.getVideoUrl()`);
  }
  assert.match(read("review.html"), /videoEl\.currentTime = videoTimeFor\(clipId, t\)/);
  const compare = read("compare.html");
  assert.doesNotMatch(compare, /v\.currentTime=(t|starts\(\)\[i\]);/, "compare seeks must include the offset");
  assert.match(compare, /videoTimeFor\(d\.clipId,starts\(\)\[i\]\)/);
  assert.match(compare, /videoTimeFor\(d\.clipId,t\)/);
  assert.match(read("components/skeletonComparison.js"), /realFrames\[frame\]\.time_s\+videoOffsetS/);
});

test("devUi.js imports every demoConfig helper it calls (a missing import only fails at runtime in the browser)", () => {
  const src = read("components/devUi.js");
  const imported = /import \{([^}]*)\} from "\.\.\/demoConfig\.js"/.exec(src)?.[1] ?? "";
  for (const fn of ["getDemoConfig", "isDemoMode"]) {
    if (new RegExp(`\\b${fn}\\(`).test(src)) assert.match(imported, new RegExp(`\\b${fn}\\b`), `${fn} is called but not imported`);
  }
});

test("devUi.js: seeks land inside the target frame (container pts rounding made phase markers show the previous frame)", () => {
  const src = read("components/devUi.js");
  assert.match(src, /export const FRAME_SEEK_EPSILON_S = 0\.001;/);
  assert.match(src, /\+ FRAME_SEEK_EPSILON_S;/);
});
