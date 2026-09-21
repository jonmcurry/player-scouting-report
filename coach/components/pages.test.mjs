// Static wiring checks for the player-development pages. There's no browser in the unit-test
// runner, so this catches the cheap-but-real failures: a page importing a name its module doesn't
// export (a blank page at runtime), a page missing the mobile viewport, or a page that isn't
// precached / cache-stamped (stale on an installed PWA).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const coach = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = ["development", "review", "compare", "atbat", "session", "queue"];
const read = (rel) => fs.readFileSync(path.join(coach, rel), "utf8");

function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/).pop();
      if (n) names.add(n);
    }
  }
  return names;
}

function importsOf(src) {
  const out = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    out.push({ from: m[2], names: m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean) });
  }
  return out;
}

function moduleSources() {
  const srcs = [];
  for (const p of PAGES) {
    const html = read(`${p}.html`);
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/);
    assert.ok(script, `${p}.html has an inline module script`);
    srcs.push({ label: `${p}.html`, dir: coach, src: script[1] });
  }
  for (const f of ["devUi.js", "devActions.js", "teamDashboard.js"]) srcs.push({ label: `components/${f}`, dir: path.join(coach, "components"), src: read(`components/${f}`) });
  for (const f of ["team.html", "player.html", "index.html", "report.html"]) {
    const m = read(f).match(/<script type="module">([\s\S]*?)<\/script>/);
    if (m) srcs.push({ label: f, dir: coach, src: m[1] });
  }
  return srcs;
}

test("every named import in the new pages/modules resolves to a real export", () => {
  for (const { label, dir, src } of moduleSources()) {
    for (const imp of importsOf(src)) {
      if (!imp.from.startsWith(".")) continue;
      const target = path.resolve(dir, imp.from);
      assert.ok(fs.existsSync(target), `${label}: ${imp.from} does not exist`);
      const have = exportsOf(fs.readFileSync(target, "utf8"));
      for (const n of imp.names) assert.ok(have.has(n), `${label}: imports "${n}" but ${imp.from} does not export it`);
    }
  }
});

test("pages are mobile-ready: viewport meta, tap-target controls, no fixed desktop widths", () => {
  for (const p of PAGES) {
    const html = read(`${p}.html`);
    const interactionSource = p === "session" ? `${html}\n${read("components/practicePage.js")}` : html;
    assert.match(html, /<meta name="viewport" content="width=device-width/, `${p}: viewport meta`);
    assert.doesNotMatch(html, /maximum-scale|user-scalable=no/, `${p}: zoom is not locked`);
    assert.match(html, /viewport-fit=cover/, `${p}: safe-area viewport enabled`);
    assert.match(interactionSource, /class="[^"]*(?:tap-target|bt-button)/, `${p}: uses touch-sized controls`);
    assert.doesNotMatch(html, /width:\s*\d{4,}px/, `${p}: no fixed wide widths`);
  }
});

test("every coach page allows zoom and opts into safe-area viewport handling", () => {
  for (const file of fs.readdirSync(coach).filter((name) => name.endsWith(".html"))) {
    const html = read(file);
    if (!/<meta name="viewport"/.test(html)) continue;
    assert.doesNotMatch(html, /maximum-scale|user-scalable=no/, `${file}: zoom restriction removed`);
    assert.match(html, /viewport-fit=cover/, `${file}: viewport-fit cover`);
  }
});

test("new pages and modules are precached and cache-stamped", () => {
  const sw = read("sw.js");
  const bump = fs.readFileSync(path.join(coach, "..", "scripts", "bump-coach-cache.mjs"), "utf8");
  for (const p of PAGES) {
    assert.ok(sw.includes(`"./${p}.html"`), `${p}.html is in sw.js ASSETS`);
    assert.ok(bump.includes(`"${p}.html"`), `${p}.html is in the cache-bump hook's stamped list`);
    assert.match(read(`${p}.html`), /coach\.css\?v=[0-9a-f]{10}/, `${p}.html carries a cache stamp`);
  }
  for (const f of ["developmentLogic.js", "devUi.js", "devActions.js", "teamDashboard.js", "phase1bScreens.js", "phase2aScreens.js", "practicePage.js", "ui.js", "shellState.js", "reviewQueue.js", "pitchEntry.js", "comparePairs.js", "logAtBatSheet.js"]) {
    assert.ok(sw.includes(`"./components/${f}"`), `components/${f} is in sw.js ASSETS`);
  }
  assert.ok(sw.includes('"./assets/icons.svg"'), "SVG icon sprite is in sw.js ASSETS");
});

test("Android Back delegates to overlay history without adding @capacitor/app", () => {
  const root = path.resolve(coach, "..");
  const activity = fs.readFileSync(path.join(root, "mobile/android/app/src/main/java/com/barreltrace/coach/MainActivity.java"), "utf8");
  const mobilePackage = JSON.parse(fs.readFileSync(path.join(root, "mobile/package.json"), "utf8"));
  assert.match(activity, /#btOverlayHost \.bt-overlay/);
  assert.match(activity, /history\.back\(\)/);
  assert.equal(mobilePackage.dependencies?.["@capacitor/app"], undefined);
});

test("every page has an empty state for its main list (no blank cards)", () => {
  for (const p of ["development", "compare", "atbat", "session", "review"]) {
    const source = p === "session" ? `${read(`${p}.html`)}\n${read("components/practicePage.js")}` : read(`${p}.html`);
    assert.match(source, /emptyState\(/, `${p}: renders explicit empty states`);
  }
});

test("Phase 2B QA: player Log at-bat uses the new sheet, never the legacy modal or alert()", () => {
  const player = read("player.html");
  assert.match(player, /openLogAtBatSheet\(/);
  assert.doesNotMatch(player, /(?<!function )openLogAbModal\(\)/, "nothing invokes the legacy 6-field modal");
  assert.doesNotMatch(player, /href="[^"]*openLog=1/, "no CTA links to ?openLog=1");
  assert.doesNotMatch(read("components/appShell.js"), /openLog=1/);
  assert.doesNotMatch(read("components/logAtBatSheet.js"), /\balert\(/);
});

test("Phase 2B QA: hidden outcome grids are hidden, take is not offered, outcomes are editable, Log without video survives at-bat end", () => {
  const css = read("coach.css"); const atbat = read("atbat.html");
  assert.match(css, /\.bt-outcome-grid\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.doesNotMatch(atbat, /data-outcome="take"/);
  assert.match(atbat, /Change outcome/);
  assert.doesNotMatch(atbat, /pitchPatchForOutcome\(outcome, count/);
  assert.equal(atbat.match(/id="logPitch"/g).length, 2, "Log without video in both action-bar states");
});

test("Phase 2B QA: pitch rows do not nest controls inside role=button", () => {
  const atbat = read("atbat.html");
  assert.doesNotMatch(atbat, /role="button"/);
  assert.match(atbat, /role="listitem"/);
  assert.match(atbat, /class="bt-list-row-copy bt-pitch-main"/);
});

test("Phase 2B QA: tabs scroll instead of splitting words; Compare transport disables without video", () => {
  const css = read("coach.css");
  assert.doesNotMatch(css.match(/\.bt-segmented-tabs a \{[^}]*\}/)[0], /overflow-wrap:\s*anywhere/);
  assert.match(css.match(/\.bt-segmented-tabs \{[^}]*\}/)[0], /overflow-x:\s*auto/);
  assert.match(css.match(/\.bt-compare-tabs \{[^}]*\}/)[0], /overflow-x:\s*auto/);
  assert.match(read("compare.html"), /const lockTransport=\(\)=>\{\["playBoth","backFrame","nextFrame","speed"\]/);
});

test("Phase 2B QA: Compare treats a media load error as unavailable and locks transport; Overview card wraps", () => {
  const compare = read("compare.html");
  assert.match(compare, /addEventListener\("error",\(\)=>dropVideo\(v\)\)/, "video error event drops the side");
  assert.match(compare, /if\(!videos\.length\) lockTransport\(\)/, "transport locks when no side is playable");
  assert.match(compare, /if\(!videos\.length\) return; const playing/, "disabled Play cannot flip to Pause");
  const css = read("coach.css");
  assert.match(css.match(/\.p1b-card-head \{[^}]*\}/)[0], /flex-wrap:\s*wrap/);
  assert.match(css.match(/\.p1b-priority-link \{[^}]*\}/)[0], /minmax\(0,1fr\)/);
  assert.match(css, /\.p1b-priority-link \.bt-status-chip \{[^}]*white-space:\s*normal/);
});

test("Phase 2B QA: Approve is in-flight locked and Retry re-runs the approval", () => {
  const review = read("review.html");
  assert.match(review, /approving\.has\(issue\.id\)/);
  assert.match(review, /onAction: \(\) => approveIssue\(issue\)/);
});

test("deep links: review.html reads ?clip and ?phase; compare.html reads ?a/?b", () => {
  const review = read("review.html");
  assert.match(review, /qs\("clip"\)/);
  assert.match(review, /qs\("phase"\)/);
  const compare = read("compare.html");
  assert.match(compare, /qs\("a"\)/);
  assert.match(compare, /qs\("b"\)/);
});
