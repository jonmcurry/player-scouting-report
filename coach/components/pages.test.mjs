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
  for (const f of ["team.html", "player.html", "index.html", "report.html", "family.html"]) {
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
  assert.match(review, /Nothing flagged on this swing\./);
  assert.match(review, /This swing has not been analyzed/);
  // An empty analysis is never presented as a clean bill of health.
  assert.match(review, /isn't a promise the swing has no issues - the coach makes that call/);
  const report = read("report.html");
  assert.doesNotMatch(report, /Your coach will add a drill/);
  // With a Priority but no Drill/progress yet, the report must not claim there is no Priority.
  assert.match(report, /No Drill picked yet\.<\/h2><p>Your coach chooses a Drill for this Priority\./);
  assert.match(report, /No progress check yet\. It appears here after your coach checks a later swing against this Priority\./);
  assert.doesNotMatch(report, /there is no Priority being tracked/);
});

test("Overview leads with development, evidence rows, and one actionable sparse-state story", () => {
  const player = read("player.html");
  assert.ok(player.indexOf('id="developmentSummary"') < player.indexOf('id="swingEvidenceList"'));
  assert.match(player, /What’s working/);
  // No Priority: one "What to work on next" card, not four empty sections - and no Drill or progress claim.
  assert.match(player, /What to work on next/);
  assert.match(player, /The coach hasn't picked a Priority yet\./);
  assert.match(player, /summary\.nextStep/);
  assert.match(read("components/playerDevelopmentSummary.js"), /Capture another swing with the full body and bat visible through contact/);
  assert.match(player, /Once the coach sets a Priority, the Drill and progress show up here\./);
  assert.ok(player.indexOf("Progress appears here as later swings") > player.indexOf("if (summary.currentPriority) {"), "progress copy only in the Priority branch");
  assert.ok(player.indexOf("Progress appears here as later swings") < player.indexOf("} else {", player.indexOf("if (summary.currentPriority) {")), "progress copy only in the Priority branch");
  // Parent view: a real coach confirms before a share link is created; the demo creates it directly.
  assert.match(player, /id="parentViewBtn"/);
  assert.match(player, /if \(!isDemoMode\(\) && !await confirmDialog\(\{ title: "Create a parent link\?"/);
  assert.match(player, />Review<.*>Compare</s);
});

test("Development uses one unified empty state while preserving real priority rendering", () => {
  const development = read("development.html");
  assert.match(development, /No Priority confirmed yet/);
  assert.doesNotMatch(development, /What we know|What still needs better evidence/, "Overview owns strengths and evidence; Development doesn't repeat them");
  assert.match(development, /data-focus-action="add-priority">Set a Priority</);
  assert.match(development, /openAddPrioritySheet\(ctx, refresh\)/);
  assert.doesNotMatch(development, /No priorities yet|No active priorities yet|No findings to review|No activity yet/);
  assert.match(development, /open\.map\(priorityCard\)/);
});

test("Practice requires a confirmed priority with an active drill", () => {
  const practice = read("components/practicePage.js");
  assert.match(practice, /No practice plan yet/);
  assert.match(practice, /A practice plan starts once the coach sets a Priority and picks a Drill/);
  assert.doesNotMatch(practice, /because the current footage needs better evidence/, "no claimed cause the data doesn't establish");
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
  assert.match(team, /observation\$\{reviewCount === 1 \? "" : "s"\} to review/);
  assert.doesNotMatch(team, /need better evidence/, "roster rows stay short");
});

test("At-bat: a recorded swing's Review link is visible in its row; unknown swing/take is not reported as 0 swings", () => {
  const atbat = read("atbat.html");
  assert.match(atbat, /bt-review-swing" href="\$\{ctx\.url\("review", \{ clip: ready\.id \}\)\}">Review swing<\/a>/);
  assert.match(atbat, /pitches\.every\(\(pitch\) => pitch\.swung != null\)/);
});

test("At-bat: analyzed state comes from analysis_runs, and an incomplete summary can be neither offered nor saved", () => {
  const atbat = read("atbat.html");
  assert.match(atbat, /from\("analysis_runs"\)\.select\("video_clip_id"\)\.in\("video_clip_id", readyIds\)/);
  assert.match(atbat, /L\.markClipsAnalyzed\(c\.data, runs\.error \? null :/);
  assert.match(atbat, /summarizeAtBat\(entry, pitches, clipsLoaded \? clips : null\)/);
  assert.match(atbat, /const saveAction = L\.atBatSummaryComplete\(summary\) \? button\("Save summary"/);
  assert.match(atbat, /async function saveSummary\(\) \{ const facts = currentSummary\(\); if \(!L\.atBatSummaryComplete\(facts\)\) \{[^}]*return; \}/);
  // A failed clip query is not evidence of "No video" or "every clip is attached".
  const unavailable = atbat.indexOf(`if (!clipsLoaded) return '<span class="bt-evidence-chip">Video status unavailable</span>';`);
  assert.ok(unavailable > 0 && unavailable < atbat.indexOf(`if (!list.length) return '<span class="bt-evidence-chip">No video</span>';`));
  assert.match(atbat, /bodyHtml: !clipsLoaded \? emptyState\("Video couldn't be loaded"/);
});

test("Player history Team Avg uses coach-verified checklist scores only (no drafts, null is missing)", () => {
  const player = read("player.html");
  // team_summary_stats averages every score, AI drafts included - not used for Team Avg.
  assert.doesNotMatch(player, /from\("team_summary_stats"\)/);
  assert.match(player, /from\("checklist_scores"\)\s*\.select\("checkpoint_id, score, review_status, players!inner\(team_id\)"\)\s*\.eq\("players\.team_id", teamId\)\s*\.eq\("review_status", "verified"\)/);
  assert.match(player, /teamStatsError \? null : teamAverageFromChecklistRows\(teamScores\)/);
  assert.doesNotMatch(player, /Number\(r\.avg_score\)/);
});

test("coach/ holds no video: webDir ships all of it into native builds and the demo sync never sources media here", () => {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(mp4|mov|m4v|webm|avi)$/i.test(entry.name)) found.push(path.relative(coach, p));
    }
  };
  walk(coach);
  assert.deepEqual(found, [], `remove video from coach/ (local demo clips belong in demo-export/): ${found.join(", ")}`);
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

test("Polish: one chevron icon, compare from one swing, honest empty queue, SW leaves cross-origin alone", () => {
  for (const f of ["player.html", "review.html", "development.html", "team.html"]) {
    assert.doesNotMatch(read(f), /⌄/, `${f}: the text glyph rendered as a plain "v" on some devices`);
  }
  const compare = read("compare.html");
  assert.match(compare, /Choose a swing to compare/, "opened from one swing, A is shown and B is the next pick");
  assert.match(compare, /B\?\.clipId\]\.filter\(Boolean\)/, "picking B while B is empty must not dereference null");
  // Changing A while B is still empty applies at once - otherwise the sheet's Compare button can never enable.
  assert.match(compare, /if \(replace && !\(replace === "a" \? B : A\)\) \{/);
  for (const label of ["Other comparisons", "Compare two moments in one swing"]) {
    assert.match(compare, new RegExp(`<span>${label}</span><span class="bt-disclosure-chevron">`), `${label} shows the chevron`);
  }
  const queue = read("queue.html");
  assert.doesNotMatch(queue, /New swings show up here after they're analyzed/, "analyzed swings with nothing flagged never land here");
  assert.match(queue, /Swings land here when the analysis flags something for the coach to check/);
  const sw = read("sw.js");
  const crossOrigin = sw.slice(sw.indexOf("if (url.origin !== self.location.origin) {"));
  assert.match(crossOrigin.slice(0, crossOrigin.indexOf("}")), /\n\s*return;\s*$/, "cross-origin GETs are not relayed through the worker's fetch()");
  assert.doesNotMatch(sw, /evt\.respondWith\(fetch\(evt\.request\)\);/);
});

test("Overview progress shows only a recorded coach observation on the current Priority", () => {
  const player = read("player.html");
  assert.match(player, /from\("player_priority_observations"\)\.select\("status, coach_note, observed_at"\)\.eq\("player_priority_id", priorityIds\[0\]\)/);
  assert.match(player, /OBSERVATION_LABELS\[latestObservation\.status\]/);
  assert.match(player, /No progress check yet\. Progress appears here as later swings are checked against this Priority\./);
});

test("family page: never imports checklistReview.js or reads AI drafts, scores or metrics", () => {
  const family = read("family.html");
  const sources = [family, read("components/familyPage.js"), read("components/captureGuide.js")];
  for (const src of sources) {
    assert.doesNotMatch(src, /checklistReview\.js/);
    assert.doesNotMatch(src, /ai_draft/);
    assert.doesNotMatch(src, /swingMetricsPanel|checklist_scores|analysis_runs|\.from\("issues"\)/);
    assert.doesNotMatch(src, /AI found/);
  }
  // Only this account's own link rows (a coach who is also a parent must not get team guardian rows).
  assert.match(family, /from\("player_guardians"\)\.select\("player_id, consented_at, consent_version"\)\.eq\("user_id", viewerId\)/);
  assert.equal((family.match(/from\("player_guardians"\)/g) ?? []).length, 1);
  // Families read through get-family-report only; no direct table reads beyond their own link rows.
  const froms = [...family.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(froms)], ["player_guardians"]);
  assert.match(family, /functions\.invoke\("get-family-report"/);
});

test("family page: invite acceptance uses the server's consent version and the existing sign-in flow", () => {
  const family = read("family.html");
  assert.match(family, /rpc\("current_guardian_consent_version"\)/);
  assert.match(family, /rpc\("accept_guardian_invite", \{ p_token: [^,]+, p_consent_version: [^}]+\}\)/);
  assert.doesNotMatch(family, /guardian-consent-\d/, "consent version is never hard-coded in the UI");
  assert.match(family, /rpc\("guardian_invite_preview", \{ p_token: token \}\)/);
  assert.match(family, /consentText\(player\)/, "consent always names the child");
  assert.doesNotMatch(family, /consentText\(""\)|your child's coach invited/i, "no unnamed consent path");
  assert.match(family, /if \(!player\) \{[\s\S]{0,200}INVITE_UNAVAILABLE/, "no preview -> one unavailable message, no consent");
  assert.match(family, /index\.html\?next=/);
  const index = read("index.html");
  assert.match(index, /familyReturnPath\(qs\("next"\)\)/);
  assert.match(index, /const familyInvite = Boolean\(familyNext && familyNext\.includes\("\?invite="\)\);\s*if \(familyInvite\) \{/, "invite copy only for invite links");
  assert.match(index, /const returnPath = familyNext \?\? simpleNext;/, "only validated in-app return paths are used");
  assert.match(index, /emailRedirectTo: new URL\(`\.\/index\.html\?next=\$\{encodeURIComponent\(returnPath\)\}`/, "email confirmation returns to the validated invite or simple home");
});

test("family and simplified routes gate stale consent before loading a child", () => {
  const family = read("family.html");
  const simple = read("components/simpleApp.js");
  assert.match(family, /select\("player_id, consented_at, consent_version"\)/);
  assert.match(family, /link\.consent_version !== version/);
  assert.match(family, /rpc\("guardian_consent_preview", \{ p_player_id: id \}\)/);
  assert.match(family, /consentVersion === CONSENT_TEXT_VERSION/);
  assert.match(family, /rpc\("renew_guardian_consent", \{ p_player_id: playerId, p_consent_version: consentVersion \}\)/);
  assert.match(simple, /link\.consent_version !== version/);
  assert.match(simple, /location\.href = "\.\/family\.html"/);
});

test("simplified reports keep confirmed no-swing separate from detector uncertainty", () => {
  const simple = read("components/simpleApp.js");
  assert.match(simple, /no_swing: "No swing"/);
  assert.match(simple, /report\.state === "no_swing"/);
  assert.match(simple, /No swing to analyze in this at-bat\./);
  assert.match(simple, /The result choice did not decide whether a swing happened\./);
  assert.match(simple, /We couldn't analyze this video/);
});

test("new simplified share URLs contain only the token while old links still open", () => {
  const simple = read("components/simpleApp.js");
  assert.match(simple, /url\.searchParams\.set\("share", token\)/);
  assert.doesNotMatch(simple, /url\.searchParams\.set\("(?:player|clip)"/);
  assert.match(simple, /state\.selected = params\.get\("player"\)/);
  assert.match(simple, /document\.querySelector\("\.simple-brand"\)\.removeAttribute\("href"\)/);
  assert.match(simple, /const clipId = params\.get\("clip"\)/);
  assert.match(simple, /if \(data\.report\) await showReport\(clipId, token, data\)/);
});

test("GameChanger CSV selection is cleared after local parsing", () => {
  const importer = read("components/rosterImportSheet.js");
  assert.match(importer, /csv = parseCsv\(await file\.text\(\)\)/);
  assert.match(importer, /finally \{ input\.value = ""; \}/);
});

test("family page: uploads go through the guardian path; Delete confirms and calls delete-clip", () => {
  const family = read("family.html");
  assert.match(family, /rpc\("guardian_create_entry"/);
  assert.match(family, /uploadRawClip\([^)]*\{ asGuardian: true \}\)/);
  assert.match(family, /await confirmDialog\(/);
  assert.match(family, /functions\.invoke\("delete-clip"/);
  assert.match(family, /functions\.invoke\("get-video-url"/);
  assert.match(family, /isDemoMode\(\)/, "demo mode has no family persona and gets a plain message");
  // "Deleting didn't finish": Try again calls delete-clip again without a second confirm.
  assert.match(family, /querySelectorAll\("\[data-retry-delete\]"\)\.forEach\(\(el\) => el\.addEventListener\("click", \(\) => sendDelete\(el\.dataset\.retryDelete, el\)\)\)/);
  assert.match(family, /async function deleteSwing\(clipId, el\) \{[\s\S]{0,400}await confirmDialog\([\s\S]{0,300}await sendDelete\(clipId, el\);/);
});

test("sign-in routing: guardian-only accounts land on the family page; coaches keep the team picker", () => {
  const index = read("index.html");
  assert.match(index, /from\("player_guardians"\)/);
  // RLS also returns a coach's team guardian rows: only the signed-in user's own links count.
  assert.match(index, /from\("player_guardians"\)\.select\("player_id"\)\.eq\("user_id", userId\)/);
  assert.match(index, /hasFamilyLinks\(session\.user\?\.id\)/);
  assert.doesNotMatch(index, /their own rows only/);
  assert.match(index, /family\.html/);
  // The coach branch is decided first: any coach_team_access row keeps the coach home.
  assert.match(index, /if \(!access \|\| access\.length === 0\) \{\s*if \(isFamily\) \{\s*window\.location\.href = "\.\/family\.html";/);
});

test("family page is precached, cache-stamped and mobile-ready", () => {
  const sw = read("sw.js");
  const bump = fs.readFileSync(path.join(coach, "..", "scripts", "bump-coach-cache.mjs"), "utf8");
  assert.ok(sw.includes('"./family.html"'));
  for (const f of ["familyPage.js", "captureGuide.js"]) assert.ok(sw.includes(`"./components/${f}"`), f);
  assert.ok(bump.includes('"family.html"'));
  const family = read("family.html");
  assert.match(family, /coach\.css\?v=[0-9a-f]{10}/);
  assert.match(family, /<meta name="viewport" content="width=device-width[^"]*viewport-fit=cover/);
  assert.match(family, /bt-button/);
});

test("Manage player: parent invites need a confirm outside the demo; list and Remove use the guardian RPCs", () => {
  const player = read("player.html");
  const manage = player.slice(player.indexOf('id="managePlayer"'), player.indexOf('id="deletePlayerBtn"'));
  assert.ok(manage.indexOf('id="shareLinksList"') < manage.indexOf('id="guardianAdmin"'), "Parents sits beside share links");
  assert.match(player, /import \{[^}]*guardianInviteUrl[^}]*\} from "\.\/components\/guardianAdmin\.js"/);
  // Mirrors the parent-link guard: a real coach confirms; the demo never creates a real invite.
  assert.match(player, /if \(isDemoMode\(\) \|\| !await confirmDialog\(INVITE_DIALOG\)\) return;/);
  assert.match(player, /rpc\("create_guardian_invite", \{ p_player_id: playerId, p_relationship: [^}]+\}\)/);
  assert.match(player, /from\("player_guardians"\)\.select\("user_id, relationship, consented_at"\)/);
  assert.match(player, /rpc\("revoke_guardian", \{ p_player_id: playerId, p_user_id: [^}]+\}\)/);
  assert.match(player, /await confirmDialog\(removeGuardianDialog\(/);
  // "Cancel pending invites": confirmed, coach-only RPC, the shown link is cleared, never in the demo.
  assert.match(player, /if \(isDemoMode\(\) \|\| !await confirmDialog\(cancelInvitesDialog\(/);
  assert.match(player, /rpc\("revoke_guardian_invites", \{ p_player_id: playerId \}\)/);
  assert.match(player, /document\.getElementById\("guardianInvite"\)\.innerHTML = "";/);
  // Demo: a short note, no invite UI and no guardian queries.
  assert.match(player, /if \(isDemoMode\(\)\) \{\s*host\.innerHTML = `<p class="hint">\$\{GUARDIAN_DEMO_NOTE\}<\/p>`;\s*return;/);
  // The token is shown once and never stored in the page beyond the invite card.
  assert.doesNotMatch(player, /localStorage\.setItem\([^)]*invite/i);
});

test("Review queue marks family uploads with a From family chip", () => {
  const queue = read("queue.html");
  assert.match(queue, /video_clips\(id,status,uploaded_by_role,/);
  assert.match(queue, /item\.fromFamily \? statusChip\("from-family", \{ label: "From family" \}\)/);
});

test("Family page: Unlink me asks about the guardian's own videos, deletes them first, then revokes", () => {
  const family = read("family.html");
  assert.match(family, /Unlink me/);
  assert.match(family, /ownUploadIds\(report\)/);
  assert.match(family, /unlinkSheet\(/);
  assert.match(family, /await confirmDialog\(unlinkConfirm\(/);
  const del = family.indexOf('functions.invoke("delete-clip", { body: { clipId: id } })');
  const revoke = family.indexOf('rpc("revoke_guardian", { p_player_id: playerId, p_user_id: viewerId })', family.indexOf("async function unlinkMe()"));
  assert.ok(del > 0 && revoke > 0 && del < revoke, "deletes own uploads before revoking (delete-clip needs the link)");
  assert.match(family, /if \(failed\) \{[\s\S]{0,200}unlinkDeleteFailedMessage\(failed\)[\s\S]{0,80}return;/, "a failed delete keeps the link");
});

test("guardian admin module is precached", () => {
  assert.ok(read("sw.js").includes('"./components/guardianAdmin.js"'));
});
