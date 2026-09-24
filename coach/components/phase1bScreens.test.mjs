import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findingActionState, nextActionModel, reviewSummary, teamAttentionModel } from "./phase1bScreens.js";

const coach = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(coach, file), "utf8");

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
  assert.match(html, /No development priority confirmed yet/);
  assert.match(html, /No drill yet/);
});

test("Review findings expose approval before priority tracking", () => {
  assert.deepEqual(findingActionState({ review_status: "draft" }, false), { reviewed: false, showApprove: true, showEdit: true, showReject: true, showTrack: false, showAssignDrill: false });
  assert.equal(findingActionState({ review_status: "approved" }, false).showTrack, true);
  assert.equal(findingActionState({ review_status: "approved" }, true).showAssignDrill, true);
  assert.equal(reviewSummary([{ review_status: "draft" }, { review_status: "approved" }]).label, "2 findings · 1 approved");
  const html = read("review.html");
  assert.match(html, /Advanced analysis/);
  assert.doesNotMatch(html, /<nav class="bottom-nav"/);
  assert.match(html, /renderDrillInAppBar/);
  assert.match(html, /showSnackbar\("Finding rejected"/);
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
    assert.equal(label, "0 findings");
    assert.doesNotMatch(label, /Draft from analysis|Not reviewed/);
  }
  const review = read("review.html");
  assert.match(review, /No finding was confirmed from this swing\./, "analyzed, no draft finding");
  assert.match(review, /This swing has not been analyzed\./, "unanalyzed heading");
  assert.match(review, /Findings appear here once analysis finishes\./, "unanalyzed explanation");
  assert.match(review, /Coach-verified across reviewed swings/);
  assert.match(review, /not independent judgments of this single swing/);
  assert.doesNotMatch(review, /Experimental 3D reconstruction|Explain in 3D/);
  assert.match(review, /No reliable measurements are published for this swing/);
  // At least one actual unreviewed AI draft finding.
  assert.equal(reviewSummary([{ review_status: "draft" }]).label, "1 finding · Draft from analysis · Not reviewed");
  assert.equal(reviewSummary([{ review_status: "draft" }, { review_status: "draft" }]).label, "2 findings · Draft from analysis · Not reviewed");
  assert.equal(reviewSummary([{ review_status: "rejected" }]).label, "1 finding", "a rejected finding is not an unreviewed draft");
});
