// Experimental v2 report rendering (M5). Synthetic data only.
import test from "node:test";
import assert from "node:assert/strict";
import { EXPERIMENTAL_LABEL, experimentalReportHtml, experimentalStillPending, outcomeCopy, seekTarget } from "./experimentalReport.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const events = [
  { id: "load_peak_estimate", label: "Load", timeS: 0.1, seekS: 0.116667, observation: "pose", estimate: false },
  { id: "impact_estimate", label: "Estimated impact", timeS: 0.266667, seekS: 0.283333, observation: "direct", estimate: true },
];
const experimental = (extra = {}) => ({ label: EXPERIMENTAL_LABEL, engine: "hitterloop-engine-v2-exp", pipelineVersion: "hitterloop-v2-exp-0.3.0",
  outcome: "findings", summary: "A steady swing.", reasons: [], events, suppressedCount: 0, retryEligible: false,
  findings: [{ kind: "issue", id: "11111111-1111-4111-8111-111111111111", claimType: "qualified_interpretation", events: ["impact_estimate"],
    phase: "contact", issue: "Front shoulder opens early", evidence: "phase_contact shows the shoulder turned", coachingCue: "Stay closed",
    lookForNext: "A closed front shoulder" },
  { kind: "strength", id: null, claimType: "direct_observation", events: ["load_peak_estimate"], phase: "load", text: "Balanced load", evidence: "Weight centered" }],
  ...extra });
const render = (exp, extra = {}) => experimentalReportHtml({ playerName: "Synthetic Player", status: "ready", videoUrl: "http://127.0.0.1/v.mp4", experimental: exp, ...extra },
  { esc, canAct: true, pendingText: "50% complete" });

test("every experimental report carries the not-validated label and never shows provider confidence", () => {
  for (const outcome of ["processing", "findings", "no_supported_issue", "insufficient_evidence", "withheld", "not_assessable", "analysis_not_enabled", "analysis_failed"]) {
    const html = render(experimental({ outcome, findings: outcome === "findings" ? experimental().findings : [] }));
    assert.match(html, /Experimental analysis — not yet validated/, outcome);
    assert.doesNotMatch(html, /confidence|medium|calibrat|accura/i, outcome);
    // "Clean swing" may only appear negated.
    assert.doesNotMatch(html.replaceAll("isn&#39;t a verified clean swing", ""), /clean swing|looks clean|nothing to fix/i, outcome);
  }
});

test("findings show claim type, the supporting moment and a See it action at the event's source time", () => {
  const html = render(experimental());
  assert.match(html, /Qualified interpretation/);
  assert.match(html, /Direct observation/);
  assert.match(html, /data-see-event="impact_estimate"/);
  assert.match(html, /Estimated hitting moment/);
  assert.doesNotMatch(html, /See it · Contact\b/);
  assert.match(html, /data-hide-issue="11111111-1111-4111-8111-111111111111"/);
  assert.equal(seekTarget(experimental(), "impact_estimate"), 0.283333);
  assert.equal(seekTarget(experimental(), "contact_confirmed"), null);
  assert.equal(seekTarget({ events: [{ id: "finish", seekS: null }] }, "finish"), null);
});

test("an all-suppressed run says evidence was insufficient, and no-issue is never called a verified clean swing", () => {
  const insufficient = outcomeCopy("insufficient_evidence", 2);
  assert.match(insufficient.title, /Not enough evidence/);
  assert.match(insufficient.body, /isn't a verified clean swing/);
  const none = outcomeCopy("no_supported_issue");
  assert.match(none.body, /isn't a verified clean swing/);
  assert.notEqual(insufficient.title, none.title, "the two outcomes are distinguishable");
});

test("unassessable swings list each specific reason; retry appears only when eligible and actionable", () => {
  const reasons = [{ code: "IDENTITY_NOT_BAT_GROUNDED", text: "We couldn't confirm which player was batting." },
    { code: "UNSUPPORTED_CAMERA_GEOMETRY", text: "The camera angle doesn't show the swing well enough." }];
  const html = render(experimental({ outcome: "not_assessable", findings: [], reasons }));
  assert.match(html, /data-reason="IDENTITY_NOT_BAT_GROUNDED"/);
  assert.match(html, /camera angle/);
  assert.doesNotMatch(html, /retry-experimental/);
  const failed = render(experimental({ outcome: "analysis_failed", findings: [], retryEligible: true }));
  assert.match(failed, /data-action="retry-experimental"/);
  const shared = experimentalReportHtml({ playerName: "P", status: "ready", experimental: experimental({ outcome: "analysis_failed", retryEligible: true }) }, { esc, canAct: false });
  assert.doesNotMatch(shared, /retry-experimental|data-hide-issue/);
});

test("pending states hide stale findings and keep refreshing until terminal", () => {
  const html = render(experimental({ outcome: "processing" }), { status: "processing" });
  assert.match(html, /Analyzing…/);
  assert.match(html, /50% complete/);
  assert.doesNotMatch(html, /Front shoulder/);
  assert.equal(experimentalStillPending({ status: "processing", experimental: experimental({ outcome: "processing" }) }), true);
  assert.equal(experimentalStillPending({ status: "failed", experimental: experimental({ outcome: "processing" }) }), false);
  assert.equal(experimentalStillPending({ status: "ready", experimental: experimental() }), false);
});

test("held-back reasons on a findings report are introduced as held back, never shown as findings", () => {
  const html = render(experimental({ suppressedCount: 1, reasons: [{ code: "NUMERIC_CLAIM", text: "A finding stated a measurement the analysis cannot support." }] }));
  assert.match(html, /One possible observation was held back:<\/p>\s*<ul class="simple-reasons"><li data-reason="NUMERIC_CLAIM">/);
  assert.doesNotMatch(render(experimental({ outcome: "not_assessable", findings: [], reasons: [{ code: "X", text: "t" }] })), /held back/);
});

test("a findings report whose issues were all hidden says so; held-back lead-in only when something was held back", () => {
  const strengthsOnly = experimental().findings.filter((f) => f.kind === "strength");
  const hidden = render(experimental({ findings: strengthsOnly, reasons: [{ code: "PREVIOUSLY_HIDDEN", text: "Hidden earlier." }] }));
  assert.match(hidden, /hidden after feedback/);
  assert.doesNotMatch(hidden, /held back:/, "a hidden finding is not presented as held back");
  const noIssue = render(experimental({ outcome: "no_supported_issue", findings: strengthsOnly, suppressedCount: 1,
    reasons: [{ code: "CAUSAL_CLAIM", text: "A finding stated a cause." }] }));
  assert.match(noIssue, /One possible observation was held back:/);
  assert.doesNotMatch(render(experimental({ events: undefined, findings: experimental().findings })), /data-see-event/, "missing events render without crashing");
});

test("text from the report is escaped", () => {
  const html = render(experimental({ summary: "<img src=x onerror=alert(1)>" }));
  assert.doesNotMatch(html, /<img src=x/);
});

test("issue headings reflect the displayed issue count and the swing action stays available", () => {
  const one = experimental();
  const single = experimentalReportHtml({ status: "ready", experimental: one, videoUrl: "https://example.com/video" }, { esc });
  assert.match(single, /One thing to work on/);
  assert.match(single, /Watch the swing/);
  const multiple = experimentalReportHtml({ status: "ready", experimental: { ...one, findings: [...one.findings, ...one.findings] } }, { esc });
  assert.match(multiple, /Something to work on/);
  assert.doesNotMatch(multiple, /One thing to work on/);
});
