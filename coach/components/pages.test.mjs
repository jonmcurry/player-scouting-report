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
  const activity = fs.readFileSync(path.join(root, "mobile/android/app/src/main/java/com/hitterloop/coach/MainActivity.java"), "utf8");
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

test("share links point at the report page even when the host serves extensionless URLs", () => {
  const m = read("player.html").match(/pathname\.replace\((\/.+?\/), "report\.html"\)/);
  assert.ok(m, "player.html builds share links from its own pathname");
  const re = eval(m[1]);
  assert.equal("/coach/player.html".replace(re, "report.html"), "/coach/report.html");
  assert.equal("/hitterloop/demo/player".replace(re, "report.html"), "/hitterloop/demo/report.html");
});

test("public copy: no 'Direct video measurement' labels, no unreviewed no-action headline, drill copy matches the workflow", () => {
  for (const f of ["compare.html", "review.html", "components/swingMetricsPanel.js", "components/developmentLogic.js"]) {
    assert.doesNotMatch(read(f), /Direct video measurement/, f);
  }
  const review = read("review.html");
  assert.doesNotMatch(review, /emptyState\("No meaningful mechanical issue/);
  assert.match(review, /No reviewed observation from this swing\./);
  assert.match(review, /This swing has not been analyzed/);
  assert.match(review, /not a judgment that the swing has no issues/);
  const report = read("report.html");
  assert.doesNotMatch(report, /Your coach will add a drill/);
  assert.match(report, /A Drill comes after your coach confirms a Priority/);
});

test("Overview leads with development, evidence rows, and one actionable sparse-state story", () => {
  const player = read("player.html");
  assert.ok(player.indexOf('id="developmentSummary"') < player.indexOf('id="swingEvidenceList"'));
  assert.match(player, /What’s working/);
  assert.match(player, /No Priority confirmed yet\./);
  assert.match(player, /summary\.nextStep/);
  assert.match(read("components/playerDevelopmentSummary.js"), /Capture another swing with the full body and bat visible through contact/);
  assert.match(player, /No Drill yet\./);
  assert.match(player, /No progress claim yet/);
  assert.match(player, />Review<.*>Compare</s);
});

test("Development uses one unified empty state while preserving real priority rendering", () => {
  const development = read("development.html");
  assert.match(development, /No Priority confirmed yet/);
  assert.match(development, /What we know/);
  assert.match(development, /What still needs better evidence/);
  assert.match(development, /Review swing evidence/);
  assert.doesNotMatch(development, /No priorities yet|No active priorities yet|No findings to review|No activity yet/);
  assert.match(development, /open\.map\(priorityCard\)/);
});

test("Practice requires a confirmed priority with an active drill", () => {
  const practice = read("components/practicePage.js");
  assert.match(practice, /No practice plan yet/);
  assert.match(practice, /Practice is tied to a confirmed development priority/);
  assert.match(practice, /hasGuidedPlan/);
  assert.match(practice, /if \(!hasGuidedPlan\) \{ renderPicker\(\); return; \}/);
  assert.match(practice, /Start practice/);
});

test("Checklist hides scoring for insufficient evidence until deliberate manual action", () => {
  const player = read("player.html");
  assert.match(player, /Current footage does not support a reliable score/);
  assert.match(player, /Score manually anyway/);
  assert.match(player, /stepper-mount" \$\{gated \? "hidden"/);
  assert.match(player, /data-manual-score/);
  assert.doesNotMatch(player, /View 3D Skeleton/);
});

test("at-bat presentation organizes swing evidence without foregrounding unknown outcomes or derived counts", () => {
  const atbat = read("atbat.html");
  assert.match(atbat, /<strong>Swing evidence<\/strong>/);
  assert.doesNotMatch(atbat, /Outcome not recorded|Count unknown| · derived/);
});

test("no public 3D anywhere reachable: no skeleton viewer, 3D quality row, or reconstructed metric", () => {
  const pages = ["team.html", "player.html", "atbat.html", "review.html", "development.html", "compare.html", "session.html", "queue.html", "report.html"];
  for (const page of pages) {
    const src = read(page);
    assert.doesNotMatch(src, /View 3D Skeleton|Explain in 3D|3D reconstruction|[Rr]econstructed estimate/, page);
    assert.doesNotMatch(src, /renderSkeletonComparison\(|openCompModal\(|canRenderExperimental3d/, `${page} renders no 3D viewer`);
  }
  // The game log's per-clip block now links to Review instead of a 3D viewer + metrics panel.
  const player = read("player.html");
  assert.doesNotMatch(player, /renderSwingMetricsPanel|loadClipSkeletonData/);
  assert.match(player, /Review swing<\/a>/);
  assert.doesNotMatch(read("components/swingMetricsPanel.js"), /3D reconstructed estimate|METRIC_SOURCE_3D/);
  assert.doesNotMatch(read("components/developmentLogic.js"), /METRIC_SOURCE_3D/);
});

test("Overview strengths use the real checkpoint names and score words, and the page script is not broken by nesting", () => {
  const player = read("player.html");
  // loadSwingEvidence was once nested inside renderStats by a bad edit, so the page threw on load.
  assert.match(player, /\n  async function loadSwingEvidence\(\) \{/);
  assert.match(player, /\n  async function renderStats\(\) \{/);
  assert.ok(player.indexOf("async function loadSwingEvidence") < player.indexOf("async function renderStats"));
  assert.match(player, /bt-score-word/);
  assert.match(player, /Current Priority/);
  assert.doesNotMatch(player, /Current focus|game swings? reviewed/);
  assert.doesNotMatch(read("components/playerDevelopmentSummary.js"), /Athletic setup|Visible load/);
});

test("Checklist: unscored checkpoints need a deliberate action; manual override is labelled", () => {
  const player = read("player.html");
  assert.match(player, /const gated = reviewedNoScore \|\| unscored;/);
  assert.match(player, /Not scored yet\./);
  assert.match(player, /data-manual-score>Add a score</);
  assert.match(player, /Manual score - not supported by the current footage evidence\./);
});

test("Team: no all-clear card when nothing is pending; roster rows lead with development state", () => {
  assert.match(read("components/teamDashboard.js"), /el\.innerHTML = attention\.reviewCount \|\| attention\.dueCount \? today : "";/);
  const team = read("team.html");
  assert.match(team, /"No Priority yet"/);
  assert.match(team, /"Next: review swing evidence"/);
});

test("At-bat: a recorded swing's Review link is visible in its row; unknown swing/take is not reported as 0 swings", () => {
  const atbat = read("atbat.html");
  assert.match(atbat, /bt-review-swing" href="\$\{ctx\.url\("review", \{ clip: ready\.id \}\)\}">Review swing<\/a>/);
  assert.match(atbat, /pitches\.every\(\(pitch\) => pitch\.swung != null\)/);
});

test("secondary Development/Practice history only renders when real history exists", () => {
  const development = read("development.html");
  for (const id of ["priorityHistory", "developmentHistory", "insightsDrawer"]) assert.match(development, new RegExp(`id="${id}" hidden`), id);
  assert.doesNotMatch(development, /No development history yet|No earlier priorities/);
  assert.doesNotMatch(read("components/practicePage.js"), /Practice history will appear here/);
});

test("every page's inline module script parses (catches template/quote breakage string checks miss)", () => {
  const AsyncFunction = (async () => {}).constructor;
  for (const page of fs.readdirSync(coach).filter((f) => f.endsWith(".html"))) {
    const scripts = [...read(page).matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    scripts.forEach((src, i) => {
      const body = src.replace(/^\s*import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "").replace(/^\s*import\s+["'][^"']+["'];?\s*$/gm, "");
      assert.doesNotThrow(() => new AsyncFunction(body), `${page} script ${i} must parse`);
    });
  }
});
