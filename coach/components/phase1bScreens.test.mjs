import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { findingActionState, nextActionModel, removedVideoNote, reviewSummary, teamAttentionModel } from "./phase1bScreens.js";

const coach = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(coach, file), "utf8");
const coachSources = (directory = coach) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolute = path.join(directory, entry.name);
  if (entry.isDirectory()) return coachSources(absolute);
  if (!/\.(?:html|[cm]?js|tsx?)$/.test(entry.name) || /\.test\.(?:[cm]?js|tsx?)$/.test(entry.name)) return [];
  return [{ relative: path.relative(coach, absolute).replaceAll("\\", "/"), source: fs.readFileSync(absolute, "utf8") }];
});

const protectedTables = new Set(["video_clips", "game_log_entries", "players"]);
const calledMember = (expression) => {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression)) {
    return expression.argumentExpression.text;
  }
  return null;
};
const receiverOf = (expression) => ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
  ? expression.expression
  : null;
function directTableDeletes({ relative, source }) {
  const bodies = relative.endsWith(".html")
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1])
    : [source];
  return bodies.flatMap((body, index) => {
    const file = ts.createSourceFile(`${relative}#${index}`, body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const tableFromExpression = (node, scopes) => {
      if (ts.isIdentifier(node)) {
        for (let i = scopes.length - 1; i >= 0; i -= 1) {
          if (scopes[i].has(node.text)) return scopes[i].get(node.text);
        }
      }
      if (!ts.isCallExpression(node)) return null;
      if (calledMember(node.expression) === "from") {
        const table = node.arguments[0];
        return table && ts.isStringLiteralLike(table) && protectedTables.has(table.text) ? table.text : null;
      }
      const receiver = receiverOf(node.expression);
      return receiver ? tableFromExpression(receiver, scopes) : null;
    };
    const found = [];
    const visit = (node, scopes) => {
      const createsScope = node !== file && (ts.isBlock(node) || ts.isFunctionLike(node));
      const activeScopes = createsScope ? [...scopes, new Map()] : scopes;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const table = tableFromExpression(node.initializer, activeScopes);
        if (table) activeScopes.at(-1).set(node.name.text, table);
      }
      if (ts.isCallExpression(node) && calledMember(node.expression) === "delete") {
        const receiver = receiverOf(node.expression);
        const table = receiver ? tableFromExpression(receiver, activeScopes) : null;
        if (table) found.push(`${relative}:${table}`);
      }
      ts.forEachChild(node, (child) => visit(child, activeScopes));
    };
    visit(file, [new Map()]);
    return found;
  });
}

test("audited deletion inventory follows syntax and lexical query scope", () => {
  const source = `
    async function removePlayer() {
      const query = supabase.from('players');
      await query['delete']();
    }
    async function removeClip() {
      const query = supabase.from(\`video_clips\`);
      await query.eq('note', 'error; retry').delete();
    }
    await supabase.from("game_log_entries").eq("id", entryId).delete();
  `;
  assert.deepEqual(directTableDeletes({ relative: "synthetic.ts", source }).sort(), [
    "synthetic.ts:game_log_entries",
    "synthetic.ts:players",
    "synthetic.ts:video_clips",
  ]);
});

test("Team attention consolidates reviews and follow-ups without zero-value peer cards", () => {
  assert.deepEqual(teamAttentionModel({ needsReview: [{ n: 2 }, { n: 1 }], dueFollowUps: [{}] }), { reviewCount: 3, dueCount: 1, headline: "3 swings to review · 1 follow-up due" });
  assert.equal(teamAttentionModel().headline, "You're all caught up.");
  const html = read("team.html");
  assert.ok(html.indexOf('id="devDash"') < html.indexOf('id="playerCards"'));
  assert.ok(html.indexOf('id="playerCards"') < html.indexOf('id="teamRecent"'));
  assert.match(read("components/teamDashboard.js"), /Review pending swings/);
});

test("Legacy next-action model remains deterministic while Player leads with development summary", () => {
  const priority = { id: "p", title: "Front-side stability" };
  assert.equal(nextActionModel({ drafts: [{ video_clip_id: "c" }], duePriority: priority }).kind, "review");
  assert.equal(nextActionModel({ duePriority: priority, priority }).kind, "follow-up");
  assert.equal(nextActionModel({ priority }).kind, "drill");
  assert.equal(nextActionModel({ priority, assignment: { drill_library: { name: "Split stance" } } }).kind, "practice");
  assert.equal(nextActionModel().kind, "atbat");
  const html = read("player.html");
  assert.ok(html.indexOf('id="developmentSummary"') < html.indexOf('id="swingEvidenceList"'));
  assert.ok(html.indexOf('id="swingEvidenceList"') < html.indexOf('id="technicalDetails"'));
  assert.match(html, /What’s working/);
  assert.match(html, /The coach hasn't picked a Priority yet\./);
  assert.doesNotMatch(html, /No Drill yet\./, "no empty Drill section before a Priority");
});

test("Review findings expose approval before priority tracking", () => {
  assert.deepEqual(findingActionState({ review_status: "draft" }, false), { reviewed: false, showApprove: true, showEdit: true, showReject: true, showTrack: false, showAssignDrill: false });
  assert.equal(findingActionState({ review_status: "approved" }, false).showTrack, true);
  assert.equal(findingActionState({ review_status: "approved" }, true).showAssignDrill, true);
  assert.equal(reviewSummary([{ review_status: "draft" }, { review_status: "approved" }]).label, "2 observations · 1 approved");
  const html = read("review.html");
  assert.match(html, /Advanced analysis/);
  assert.doesNotMatch(html, /<nav class="bottom-nav"/);
  assert.match(html, /renderDrillInAppBar/);
  assert.match(html, /showSnackbar\("Observation rejected"/);
});

test("Phase 1B screens add no native confirm or alert calls", () => {
  assert.doesNotMatch(read("team.html"), /\b(?:confirm|alert)\s*\(/);
  assert.doesNotMatch(read("review.html"), /\b(?:confirm|alert)\s*\(/);
});

test("Swing Review phase track uses the standard coaching sequence", () => {
  const source = read("components/devUi.js");
  assert.match(source, /\["stance", "load", "stride", "contact", "extension", "follow-through"\]/);
  assert.match(source, /\.sort\(\(a, b\).*order\.get\(a\.slug\)/s);
});

test("Review summary: zero findings are never labelled a draft; only real unreviewed AI drafts are", () => {
  // Unanalyzed swing (no analysis run) and analyzed swing with no draft finding both have zero issues.
  for (const issues of [[], undefined]) {
    const label = reviewSummary(issues).label;
    assert.equal(label, "0 observations");
    assert.doesNotMatch(label, /Draft from analysis|Not reviewed/);
  }
  const review = read("review.html");
  assert.match(review, /Nothing flagged on this swing\./, "analyzed, no draft observation");
  assert.match(review, /This swing has not been analyzed\./, "unanalyzed heading");
  assert.match(review, /"Not analyzed"/, "unanalyzed status never reads like pending analysis");
  assert.doesNotMatch(review, /Awaiting analysis|Findings appear here once analysis finishes/);
  assert.match(review, /strength\$\{summary\.strengths\.length === 1 \? "" : "s"\} the coach has checked/);
  // Player-level strengths are labelled as such on a single swing's review.
  assert.match(review, /From the coach's review of all of .*swings, not only this one\./);
  assert.doesNotMatch(review, /Experimental 3D reconstruction|Explain in 3D/);
  // Metrics fail closed: no published values means no Measurements drawer at all, not an empty card.
  assert.match(review, /id="metricsDrawer" hidden/);
  assert.match(review, /if \(!hasPublishedMetrics\(row\)\) \{ metricsDrawer\.remove\(\); return; \}/);
  assert.doesNotMatch(review, /No reliable measurements are published/);
  assert.doesNotMatch(review, /\["3D reconstruction", q\.reconstruction\]/, "no 3D quality row");
  // At least one actual unreviewed AI draft finding.
  assert.equal(reviewSummary([{ review_status: "draft" }]).label, "1 observation · Draft from analysis · Not reviewed");
  assert.equal(reviewSummary([{ review_status: "draft" }, { review_status: "draft" }]).label, "2 observations · Draft from analysis · Not reviewed");
  assert.equal(reviewSummary([{ review_status: "rejected" }]).label, "1 observation", "a rejected observation is not an unreviewed draft");
});

test("Task 2b: a reviewed finding whose clip was deleted says who removed the video - never a guess for clip-less findings", () => {
  const removals = new Map([["i-family", "guardian"], ["i-coach", "coach"]]);
  assert.equal(removedVideoNote({ id: "i-family", review_status: "approved", video_clip_id: null }, removals), "Video removed by family");
  assert.equal(removedVideoNote({ id: "i-coach", review_status: "edited", video_clip_id: null }, removals), "Video removed by coach");
  // A finding that never had a clip (legacy/CLI) has no removal record: no claim at all.
  assert.equal(removedVideoNote({ id: "i-legacy", review_status: "approved", video_clip_id: null }, removals), null);
  // Still linked to a clip -> nothing removed.
  assert.equal(removedVideoNote({ id: "i-family", review_status: "approved", video_clip_id: "c1" }, removals), null);
  // Drafts are deleted with the clip; a stray draft never gets the label.
  assert.equal(removedVideoNote({ id: "i-family", review_status: "draft", video_clip_id: null }, removals), null);
  assert.equal(removedVideoNote(null, removals), null);
  assert.equal(removedVideoNote({ id: "i-family", review_status: "approved", video_clip_id: null }, null), null);

  // The coach surfaces that list reviewed findings render it from the removal RPC.
  for (const file of ["player.html", "development.html"]) {
    const html = read(file);
    assert.match(html, /clip_removals_for_player/, file);
    assert.match(html, /removedVideoNote\(/, file);
  }
  // Every legacy coach removal path deletes clips through the shared audited
  // function before removing its owning row. A row-only clip delete remains
  // only for a demo visitor's clone without GCS media.
  const player = read("player.html");
  const practice = read("components/practicePage.js");
  const deletion = read("components/clipDeletion.js");
  assert.match(player, /deleteClip\(clipId\)/);
  assert.match(player, /deleteClipsForEntry\(gameLogEntryId\)[\s\S]{0,300}?from\("game_log_entries"\)\.delete\(\)/);
  assert.match(player, /deleteClipsForPlayer\(playerId\)[\s\S]{0,300}?from\("players"\)\.delete\(\)/);
  assert.match(practice, /deleteClipsForEntry\(rep\.game_log_entry_id\)[\s\S]{0,300}?from\("game_log_entries"\)\.delete\(\)/);
  assert.match(deletion, /deleteClipsForEntry[\s\S]*?deleteClip\(clip\.id\)/);
  assert.match(deletion, /deleteClipsForPlayer[\s\S]*?deleteClipsForEntry\(entry\.id\)/);
  assert.match(deletion, /functions\.invoke\("delete-clip"/);
  assert.match(player, /Delete this pitch clip and its 3D data\? This can't be undone\./);
  assert.equal(deletion.match(/from\("video_clips"\)\.delete\(\)/g)?.length, 1);
  assert.match(deletion, /if \(isDemoMode\(\)\) \{[\s\S]{0,300}?from\("video_clips"\)\.delete\(\)/);

  const directDeletes = coachSources().flatMap(directTableDeletes).sort();
  assert.deepEqual(directDeletes, [
    "components/clipDeletion.js:video_clips",
    "components/practicePage.js:game_log_entries",
    "player.html:game_log_entries",
    "player.html:players",
  ], "new direct deletion sites must be routed through and covered by the audited helper");
});
