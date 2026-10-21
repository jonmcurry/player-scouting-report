import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createNavigation, initNavigation } from "./simpleNavigation.js";
import * as guardianAdmin from "./guardianAdmin.js";
import { icon } from "./ui.js";
import { experimentalReportHtml, experimentalStillPending, seekTarget, eventLabel } from "./experimentalReport.js";
import * as presentation from "./simplePresentation.js";
import { baselinePresentation, experimentalPresentation } from "../../dist/services/development/reportPresentation.js";
import { demoShowcase } from "./demoShowcase.js";
import { plainFailureReason } from "../../dist/services/development/reportAssembly.js";
const { REPORT_COPY: copy, fixNoneCopy, strengthsNoneCopy, unavailablePresentation,
  userErrorMessage, describeFunctionsError, reportFetchFailure } = presentation;
const unavailableFromServer = input => unavailablePresentation({ presentation: baselinePresentation({ ...input, issues: [] }) });
const httpError = (status) => Object.assign(new Error("Edge Function returned a non-2xx status code"), {
  name: "FunctionsHttpError", context: new Response(JSON.stringify({ error: "private server detail" }), { status }),
});
const captureCases = [["batter", "batter missing"], ["swing", "no swing"], ["short", "too short"], ["blurry", "blur"]];

test("frozen copy and empty sections use the approved wording", () => {
  assert.ok(Object.isFrozen(copy));
  assert.equal(fixNoneCopy(), "We didn't see one clear thing to work on in this swing. One video can't show everything; patterns show up over 3+ game at-bats.");
  assert.equal(strengthsNoneCopy(), "Nothing stood out clearly enough to call out in this swing.");
});

test("capture failures match server copy and offer filming guidance without findings", () => {
  for (const [key, internal] of captureCases) {
    assert.equal(copy[key], plainFailureReason(internal));
    assert.deepEqual(unavailableFromServer({ status: "failed", report: { reason: copy[key], summary: "must not escape" } }), {
      kind: "unavailable_evidence", title: "We couldn't analyze this swing", reason: copy[key], showFilmingTip: true,
    });
  }
});

test("duration and unknown technical failures do not blame capture", () => {
  assert.equal(copy.duration, plainFailureReason("3-minute upload limit"));
  assert.deepEqual(unavailableFromServer({ status: "failed", report: { reason: copy.duration } }), {
    kind: "failed_technical", title: "We couldn't analyze this video", reason: copy.duration, showFilmingTip: false,
  });
  for (const reason of [undefined, "private runtime detail", copy.unavailableReason]) {
    assert.deepEqual(unavailableFromServer({ status: "failed", report: { reason } }), {
      kind: "failed_technical", title: "Something went wrong on our side.",
      reason: "We couldn't finish analyzing this video.", showFilmingTip: false,
    });
  }
});

test("ready but unreadable reports use the contract fallback rather than legacy reason text", () => {
  for (const reason of [copy.batter, undefined, ""]) {
    assert.deepEqual(unavailableFromServer({ status: "ready", report: { state: "unreadable", reason } }), {
      kind: "unavailable_evidence", title: "We couldn't analyze this swing",
      reason: "We couldn't analyze this video.", showFilmingTip: true,
    });
  }
});

test("HTTP status mapping has exact signed-in and shared copy", async () => {
  for (const shared of [false, true]) for (const status of [401, 404, 500, 503]) {
    const error = httpError(status);
    const expected = status === 401 ? "Please sign in again." : status === 404
      ? shared ? "This link has expired or was turned off. Ask the person who sent it for a new one."
        : "This isn't available. It may have been deleted or the link turned off."
      : "HitterLoop is having trouble right now. Try again in a minute.";
    assert.equal(userErrorMessage(error, { shared, ...await describeFunctionsError(error) }), expected);
    assert.equal(userErrorMessage(null, { shared, status }), expected);
    assert.equal(error.context.bodyUsed, false);
  }
});

test("network, unknown transport and database errors never expose raw details", () => {
  // "Load failed" is WebKit's wording for the same network failure.
  for (const error of [Object.assign(new Error("private"), { name: "FunctionsFetchError" }), new TypeError("Failed to fetch"), new TypeError("Load failed")]) {
    assert.equal(userErrorMessage(error), "You're offline. Reports will load when you reconnect.");
  }
  assert.equal(userErrorMessage(httpError(401), { online: false }), copy.offline);
  for (const error of [Object.assign(new Error("private"), { name: "FunctionsRelayError" }),
    { message: "private database detail", code: "42501", details: "private" },
    ...["Edge Function failed", "Failed to fetch", "fetch failed", "NetworkError", "non-2xx"].map((s) => new Error(s)),
    httpError(400), new TypeError("unknown transport"), null]) {
    assert.equal(userErrorMessage(error), copy.trouble);
  }
  assert.equal(userErrorMessage(new Error("private"), { transport: true }), copy.trouble);
  assert.equal(userErrorMessage(new Error("Choose a player.")), "Choose a player.");
  assert.equal(userErrorMessage(Object.assign(new Error(copy.sharedMissing), { userFacing: true }), { shared: true }), copy.sharedMissing);
});

test("only allowlisted response copy is shown; malformed JSON fails closed", async () => {
  assert.equal(userErrorMessage(httpError(400), { bodyError: copy.signIn }), copy.signIn);
  assert.equal(userErrorMessage(httpError(400), { bodyError: "private token or SQL" }), copy.trouble);
  const malformed = { context: new Response("not json", { status: 500 }) };
  assert.deepEqual(await describeFunctionsError(malformed), { status: 500, bodyError: undefined });
  assert.deepEqual(await describeFunctionsError(null), { status: null, bodyError: undefined });
});

test("diagnostics contain only a fixed function name and valid HTTP status", () => {
  assert.deepEqual(reportFetchFailure({ status: 404, token: "secret", url: "private", body: "private", name: "private" }), {
    functionName: "get-simplified-report", status: 404,
  });
  assert.deepEqual(reportFetchFailure({ status: "private" }), { functionName: "get-simplified-report", status: null });
});

test("presentation copy emits no confirmed-moment, transport, or certainty language", () => {
  const output = [copy, fixNoneCopy(), strengthsNoneCopy(), ...captureCases.map(([key]) =>
    unavailableFromServer({ status: "failed", report: { reason: copy[key] } })),
    unavailableFromServer({ status: "failed", report: {} }), userErrorMessage(httpError(500)), reportFetchFailure()];
  assert.doesNotMatch(JSON.stringify(output), /contact|Edge Function|confidence|%/i);
});

// Execute the actual UI wiring with synthetic transport/DOM objects; no browser, footage or account.
async function appHarness({ shared = true, online = true, error = httpError(404), data = null } = {}) {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: "", querySelectorAll: () => [], insertAdjacentHTML(_position, html) { this.innerHTML += html; }, hidden: false, listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; }, removeAttribute() {}, setAttribute() {}, after(element) { this.afterNode = element; }, load() {}, showModal() { this.open = true; }, close() { this.open = false; }, appendChild() {} });
    return nodes.get(id);
  };
  const warnings = []; const listeners = []; const snacks = []; const rpcs = []; const confirms = []; let reloads = 0;
  const source = (await readFile(new URL("./simpleApp.js", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "").replace(/start\(\);\s*$/, "");
  const sandbox = { ...presentation, ...guardianAdmin, icon, experimentalReportHtml, experimentalStillPending, seekTarget, eventLabel, createNavigation, initNavigation, PUBLIC_APP_ORIGIN: "",
    captureModeHtml: () => "Synthetic guide", showSnackbar: (text) => snacks.push(text), topOverlayId: () => null,
    iconButton: (icon, label, { attrs }) => `<button aria-label="${label}" ${attrs}></button>`,
    confirmDialog: async (options) => { confirms.push(options); return false; }, Error, URL, URLSearchParams, console: { warn: (value) => warnings.push(value) },
    setTimeout, clearTimeout, navigator: { onLine: online }, isDemoMode: () => false,
    escapeHtml: (s) => s.replaceAll("<", "&lt;"), location: { search: shared ? "?share=synthetic" : "", reload: () => reloads++ },
    window: { history: { replaceState() {}, pushState() {}, back() {}, go() {} }, scrollY: 0, scrollTo() {}, addEventListener: (...args) => listeners.push(args) },
    document: { createElement: () => node("created"), getElementById: node, querySelector: node, querySelectorAll: () => [], addEventListener() {} },
    supabase: { rpc: async (...args) => { rpcs.push(args); return { data: "token" }; }, functions: { invoke: async () => ({ data, error }) }, auth: { getSession: async () => { throw error; } } },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  await vm.runInContext("start()", sandbox);
  return { sandbox, node, warnings, listeners, snacks, rpcs, confirms, reloads: () => reloads };
}

test("initial expired share renders an alert and heading with no retry or chrome", async () => {
  const h = await appHarness();
  assert.match(h.node("simpleRoot").innerHTML, /<h1>Link unavailable<\/h1>/);
  assert.match(h.node("simpleRoot").innerHTML, /role="alert"/);
  assert.ok(h.node("simpleRoot").innerHTML.includes(copy.sharedMissing));
  assert.doesNotMatch(h.node("simpleRoot").innerHTML, /<button|Edge Function|private/);
  assert.equal(h.node(".simple-top").hidden, true);
  assert.equal(h.node(".simple-nav").hidden, true);
  assert.equal(JSON.stringify(h.warnings), JSON.stringify([{ functionName: "get-simplified-report", status: 404 }]));
});

test("initial transport errors map safely and offer one reload action", async () => {
  for (const [error, expected] of [[httpError(500), copy.trouble],
    [Object.assign(new Error("raw"), { name: "FunctionsFetchError" }), copy.offline],
    [Object.assign(new Error("raw"), { name: "FunctionsRelayError" }), copy.trouble]]) {
    const h = await appHarness({ error });
    assert.ok(h.node("simpleRoot").innerHTML.includes(expected));
    assert.equal((h.node("simpleRoot").innerHTML.match(/<button/g) ?? []).length, 1);
    assert.doesNotMatch(h.node("simpleRoot").innerHTML, /raw|Edge Function/);
  }
  const h = await appHarness({ shared: false, online: false });
  const retry = h.listeners.find(([event, , options]) => event === "online" && options?.once);
  assert.ok(retry);
  retry[1]();
  assert.equal(h.reloads(), 1);
});


test("standard unavailable rendering preserves video and Delete, and only capture failures offer filming tips", async () => {
  const h = await appHarness();
  vm.runInContext("state.shared = false; loadCaptureSummary = async () => {};", h.sandbox);
  for (const [status, reason, tip] of [["failed", copy.batter, true], ["failed", copy.duration, false],
    ["failed", "unknown", false], ["ready", copy.unavailableReason, true]]) {
    h.sandbox.payload = { status, videoUrl: "https://example.invalid/synthetic.mp4", report: { state: "unreadable", reason } };
    h.sandbox.payload.presentation = baselinePresentation({ ...h.sandbox.payload, issues: [] });
    await vm.runInContext('showReport("synthetic", null, payload)', h.sandbox);
    const html = h.node("simpleRoot").innerHTML;
    assert.match(html, /<h1>/);
    assert.match(html, /<video/);
    assert.match(html, /Delete at-bat/);
    assert.equal(html.includes("How to film next time"), tip);
    assert.doesNotMatch(html, /How it went|What looked good|One thing to fix|Drills|retry/);
  }
});

test("Experimental Watch the swing seeks half a second early, clamps at zero, and plays", async () => {
  const h = await appHarness();
  const video = h.node("reportVideo");
  let at = 0; let plays = 0;
  video.readyState = 1; video.duration = 10;
  video.removeEventListener = () => {};
  video.play = async () => { plays++; };
  Object.defineProperty(video, "currentTime", { get: () => at, set: (value) => {
    at = value; queueMicrotask(() => video.listeners.seeked?.());
  } });
  for (const [time, expected] of [[2, 1.5], [0.2, 0]]) {
    vm.runInContext(`state.report = { experimental: { events: [{ id: "impact_estimate", seekS: ${time} }] } };`, h.sandbox);
    await h.node("simpleRoot").listeners.click({ target: { closest: () => ({ dataset: { action: "jump-contact" } }) } });
    assert.equal(at, expected);
  }
  assert.equal(plays, 2);
});

test("public links accept only HTTPS DNS origins and approved pages", () => {
  for (const origin of [undefined, "", "broken", "http://app.example.com", "https://localhost", "https://a.localhost", "https://127.0.0.1", "https://10.0.2.2", "https://192.168.1.231", "https://172.20.0.1", "https://169.254.1.1", "https://100.64.1.1", "https://[::1]", "https://[fc00::1]", "https://fc00::1", "https://[fe80::1]", "https://[::ffff:192.168.1.1]", "https://127.1", "https://0x7f000001", "https://app.local", "https://app.internal", "https://single", "https://user:pass@app.example.com", "https://app.example.com/path", "https://app.example.com/?q=1", "https://app.example.com/#x", "https://app.example.com?", "https://app.example.com#"]) {
    assert.equal(presentation.publicAppLink(origin, "simple.html"), null, String(origin));
  }
  assert.equal(presentation.publicAppLink("https://app.example.com", "wrong.html"), null);
  assert.equal(presentation.publicAppLink("https://app.example.com", "simple.html", { share: "a&b" }), "https://app.example.com/simple.html?share=a%26b");
  assert.equal(presentation.publicAppLink("https://app.example.com/", "family.html", { invite: "token" }), "https://app.example.com/family.html?invite=token");
});

test("unconfigured share and invite create no tokens and show snackbar copy", async () => {
  const h = await appHarness();
  await vm.runInContext('share("report")', h.sandbox);
  assert.equal(h.snacks.at(-1), "Sharing isn't set up in this build yet.");
  vm.runInContext('state.shared = false; state.role = "coach"; state.players = [{ id: "player" }]', h.sandbox);
  await h.node("simpleRoot").listeners.click({ target: { closest: () => ({ dataset: { action: "invite-parent", invitePlayer: "player" } }) } });
  assert.equal(h.snacks.at(-1), "Invite links aren't set up in this build yet.");
  assert.equal(h.rpcs.length, 0);
  assert.doesNotMatch(h.snacks.join(" "), /Edge Function/);
});

test("delete uses the shared destructive confirmation and cancel performs no RPC", async () => {
  const h = await appHarness();
  vm.runInContext('state.report = { clipId: "clip", entryId: "entry" };', h.sandbox);
  await h.node("simpleRoot").listeners.click({ target: { closest: () => ({ dataset: { action: "delete" } }) } });
  assert.equal(h.confirms[0].title, "Delete this at-bat?");
  assert.equal(h.confirms[0].destructive, true);
  assert.equal(h.rpcs.length, 0);
  const source = await readFile(new URL("./simpleApp.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:confirm|alert|prompt)\(/);
  assert.match(source, /One thing to work on/);
  const sprite = await readFile(new URL("../assets/icons.svg", import.meta.url), "utf8");
  const backIcon = source.match(/iconButton\("([^"]+)"/)[1];
  assert.ok(sprite.includes(`id="${backIcon}"`));
  assert.doesNotMatch(source, /One thing to fix|message.textContent/);
});

test("report app bars use feed date/kind, preserve player subtitle, and omit back for shares", async () => {
  const h = await appHarness();
  vm.runInContext('state.shared = false; state.home = { feed: [{ id: "clip", date: "2026-10-11", kind: "practice" }] };', h.sandbox);
  h.sandbox.payload = { playerName: "Synthetic Player", status: "ready", presentation: baselinePresentation({ status: "ready", report: { state: "no_swing" } }), report: { state: "no_swing" } };
  await vm.runInContext('showReport("clip", null, payload)', h.sandbox);
  assert.match(h.node("simpleRoot").innerHTML, /Oct 11 · Practice/);
  assert.match(h.node("simpleRoot").innerHTML, /Back to Home/);
  assert.match(h.node("simpleRoot").innerHTML, /<p>Synthetic Player<\/p>/);
  vm.runInContext('state.shared = true; state.home = null;', h.sandbox);
  await vm.runInContext('showReport("clip", null, payload)', h.sandbox);
  assert.match(h.node("simpleRoot").innerHTML, /<h1>At-bat report<\/h1>/);
  assert.doesNotMatch(h.node("simpleRoot").innerHTML, /Back to/);
});

test("sheet restoration preserves unsent files, kind, result, camera view and chosen player", async () => {
  const h = await appHarness();
  vm.runInContext('state.players = [{ id: "a", name: "A" }, { id: "b", name: "B" }]; state.selected = "a"; choiceSheet(); confirmSheet([{ name: "synthetic.mp4" }]); state.kind = "practice"; state.result = "hit"; state.captureProfile = "open_side_practice"; state.capturePlayer = "b";', h.sandbox);
  await vm.runInContext('navigation.pop({ state: { hl: "sheet", name: "choice" } })', h.sandbox);
  assert.match(h.node("captureSheet").innerHTML, /Record at-bat/);
  assert.equal(vm.runInContext('state.files[0].name', h.sandbox), "synthetic.mp4");
  vm.runInContext('confirmSheet(state.files, true); guideSheet();', h.sandbox);
  await vm.runInContext('navigation.pop({ state: { hl: "sheet", name: "confirm" } })', h.sandbox);
  const html = h.node("captureSheet").innerHTML;
  assert.match(html, /value="b" selected/);
  assert.match(html, /data-kind="practice" aria-pressed="true"/);
  assert.match(html, /data-result="hit" aria-pressed="true"/);
  assert.match(html, /data-capture-profile="open_side_practice" aria-pressed="true"/);
});

test("send validation errors stay beside Send and do not become a snackbar", async () => {
  const h = await appHarness();
  vm.runInContext('state.players = [{ id: "a", name: "A" }]; state.selected = "a"; confirmSheet([{ name: "synthetic.mp4" }]);', h.sandbox);
  h.node("capturePlayer").value = "unknown";
  const button = { disabled: false };
  h.sandbox.sendButton = button;
  await vm.runInContext('sendCaptures(sendButton)', h.sandbox);
  assert.equal(h.node("sendError").textContent, "Choose a player.");
  assert.match(h.node("captureSheet").innerHTML, /id="sendError" class="simple-error" role="alert"/);
  assert.equal(button.disabled, false);
  assert.equal(h.snacks.length, 0);
});

test("native sharing cancellation is silent and token links use the configured origin", async () => {
  const h = await appHarness();
  h.sandbox.PUBLIC_APP_ORIGIN = "https://app.example.com";
  let sharedUrl;
  h.sandbox.navigator.share = async ({ url }) => { sharedUrl = url; throw Object.assign(new Error("cancel"), { name: "AbortError" }); };
  await vm.runInContext('share("report")', h.sandbox);
  assert.equal(sharedUrl, "https://app.example.com/simple.html?share=token");
  assert.equal(h.snacks.length, 0);
});

test("only improving and looks_fixed receive a success tone", () => {
  for (const status of ["improving", "looks_fixed", "early_read", "checking", "still_showing", "no_pattern", "active", "fixed", "unknown", null]) {
    assert.equal(presentation.progressTone(status), ["improving", "looks_fixed"].includes(status) ? "success" : "neutral");
  }
});

const clickAction = (h, dataset, sheet = false) => h.node(sheet ? "captureSheet" : "simpleRoot").listeners.click({ target: { closest: () => ({ dataset }) } });
const withPresentation = payload => ({ ...payload, presentation: baselinePresentation({ ...payload, issues: [] }) });
const readyPayload = (fix = true) => withPresentation({ playerName: "Synthetic Player", status: "ready", videoUrl: "https://example.invalid/video", report: {
  state: "ready", summary: "Synthetic summary", strengths: ["Synthetic strength"], drills: [],
  fix: fix ? { id: "issue", issue: "Synthetic issue", evidence: "Synthetic evidence", coachingCue: "Cue", lookForNext: "Next" } : null,
} });

test("ready, no-fix, unavailable and experimental reports have semantic heading order", async () => {
  const h = await appHarness();
  vm.runInContext('loadCaptureSummary = async () => {}; loadCoachAnalysisAction = async () => {};', h.sandbox);
  for (const payload of [readyPayload(), readyPayload(false), { status: "failed", report: { state: "unreadable" } },
    { ...readyPayload(), experimental: { outcome: "findings", suppressedCount: 0, events: [], findings: [
      { kind: "issue", id: "issue", issue: "Synthetic issue", claimType: "direct_observation" },
      { kind: "strength", text: "Synthetic strength", claimType: "direct_observation" },
    ] } }]) {
    h.sandbox.payload = payload;
    await vm.runInContext('showReport("clip", null, payload)', h.sandbox);
    const html = h.node("simpleRoot").innerHTML;
    const levels = [...html.matchAll(/<h([123])(?:\s[^>]*)?>/g)].map((match) => Number(match[1]));
    assert.equal(levels.filter((level) => level === 1).length, 1);
    assert.equal(levels[0], 1);
    assert.ok(levels.includes(2));
    levels.forEach((level, i) => { if (i) assert.ok(level <= levels[i - 1] + 1); });
    if (payload.report.fix) assert.ok(levels.includes(3));
    if (payload.report.strengths) assert.match(html, /icons.svg#check/);
    assert.doesNotMatch(html, /class="simple-strength"|✓|Refresh video/);
  }
});

test("Home and Progress sections use h2; all progress states have text and matching tones", async () => {
  const h = await appHarness();
  vm.runInContext('state.home = { playerName: "Synthetic", feed: [] };', h.sandbox);
  await vm.runInContext('showHome()', h.sandbox);
  h.sandbox.document.getElementById = (id) => ["thenVideo", "nowVideo"].includes(id) ? null : h.node(id);
  assert.match(h.node("simpleRoot").innerHTML, /<h2>Recent at-bats<\/h2>/);
  // The real visible statuses from progressView.ts, with and without a current focus.
  const labels = { early_read: "Early read", checking: "Checking", still_showing: "Still showing up",
    improving: "Improving", looks_fixed: "Looks fixed", no_pattern: "No clear pattern" };
  for (const [status, label] of Object.entries(labels)) {
    for (const current of [null, { concept: "front_side_stability", status, startedAt: "2026-10-01", seen: 2, windowSize: 5 }]) {
      h.sandbox.payload = { playerName: "Synthetic", progress: { status, current, history: [] } };
      await vm.runInContext('state.home = payload; showProgress()', h.sandbox);
      const tone = ["improving", "looks_fixed"].includes(status) ? "success" : "neutral";
      assert.match(h.node("simpleRoot").innerHTML, new RegExp(`bt-status-${tone}">${label}<`));
    }
  }
});

test("How to film puts its safety note before controls and checklist", async () => {
  const h = await appHarness();
  vm.runInContext('guideSheet()', h.sandbox);
  const html = h.node("captureSheet").innerHTML;
  assert.match(html, /class="simple-safety-note" role="note"/);
  assert.ok(html.indexOf('role="note"') < html.indexOf("Guide sport"));
  assert.ok(html.indexOf('role="note"') < html.indexOf("Synthetic guide"));
});

async function deleteHarness({ failClip = null, cleanup = false, experimental = false, online = true } = {}) {
  const h = await appHarness({ online });
  h.calls = []; h.navigations = []; h.refreshes = 0;
  h.sandbox.confirmDialog = async () => true;
  h.sandbox.deleteClip = async (id) => { h.calls.push(id); if (id === failClip) throw new Error("private transport text"); };
  h.sandbox.supabase.rpc = async (name) => { h.calls.push(name); return { error: cleanup ? new Error("private cleanup text") : null }; };
  h.sandbox.reportApi = async () => { h.refreshes++; return { feed: [], playerName: "Synthetic" }; };
  h.sandbox.onNavigate = (tab) => h.navigations.push(tab);
  vm.runInContext(`state.shared = false; state.tab = "report"; state.report = { clipId: "own", entryId: "entry", entryClipIds: ["own", "sibling-a", "sibling-b"], experimental: ${experimental} }; state.home = { feed: [{ id: "own", entryId: "entry" }] }; navigation.returnFromReport = async () => onNavigate("home");`, h.sandbox);
  h.node("simpleRoot").innerHTML = '<video src="synthetic"></video>';
  h.button = { dataset: { action: "delete" }, disabled: false, textContent: "Delete at-bat", setAttribute() {} };
  h.click = () => h.node("simpleRoot").listeners.click({ target: { closest: () => h.button } });
  return h;
}

test("delete success deletes siblings first and navigates once for normal and experimental reports", async () => {
  for (const experimental of [false, true]) {
    const h = await deleteHarness({ experimental });
    await h.click();
    assert.deepEqual(h.calls, ["sibling-a", "sibling-b", "own", "delete_simple_at_bat"]);
    assert.deepEqual(h.navigations, ["home"]);
    assert.equal(h.refreshes, 1);
    assert.equal(h.snacks.at(-1), "At-bat deleted.");
  }
});

test("clip failures preserve report/video and restore Delete with friendly copy", async () => {
  for (const [failClip, expected] of [["sibling-a", "We couldn't delete this at-bat. Try again."],
    ["sibling-b", "Some videos couldn't be deleted. Try again."], ["own", "Some videos couldn't be deleted. Try again."]]) {
    const h = await deleteHarness({ failClip });
    await h.click();
    assert.deepEqual(h.navigations, []);
    assert.equal(h.refreshes, 0);
    assert.match(h.node("simpleRoot").innerHTML, /<video/);
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.textContent, "Delete at-bat");
    assert.equal(h.snacks.at(-1), expected);
    assert.ok(!h.calls.includes("delete_simple_at_bat"));
  }
});

test("retry after partial deletion skips already confirmed siblings", async () => {
  const h = await deleteHarness({ failClip: "sibling-b" });
  await h.click();
  h.sandbox.deleteClip = async (id) => h.calls.push(id);
  await h.click();
  assert.deepEqual(h.calls, ["sibling-a", "sibling-b", "sibling-b", "own", "delete_simple_at_bat"]);
  assert.deepEqual(h.navigations, ["home"]);
});

test("entry-only failure still navigates Home with cleanup copy, even when feed refresh fails", async () => {
  const h = await deleteHarness({ cleanup: true });
  h.sandbox.reportApi = async () => { throw new Error("offline"); };
  await h.click();
  assert.deepEqual(h.navigations, ["home"]);
  assert.equal(h.snacks.at(-1), "Video deleted, but the empty at-bat record still needs cleanup.");
  assert.equal(vm.runInContext('state.home.feed.length', h.sandbox), 0);
});

test("offline and cancel do not delete, and repeated taps share one confirmation and sequence", async () => {
  const offline = await deleteHarness({ online: false });
  await offline.click();
  assert.deepEqual(offline.calls, []);
  assert.equal(offline.snacks.at(-1), "You're offline. Nothing was deleted.");
  const h = await deleteHarness();
  let resolveConfirm; let confirms = 0;
  h.sandbox.confirmDialog = () => { confirms++; return new Promise((resolve) => { resolveConfirm = resolve; }); };
  const cancelled = h.click(); await h.click();
  resolveConfirm(false); await cancelled;
  assert.equal(confirms, 1);
  assert.deepEqual(h.calls, []);
  assert.equal(h.button.textContent, "Delete at-bat");
  let resolveDelete;
  h.sandbox.confirmDialog = async () => true;
  h.sandbox.deleteClip = (id) => { h.calls.push(id); return id === "sibling-a" ? new Promise((resolve) => { resolveDelete = resolve; }) : Promise.resolve(); };
  const deleting = h.click(); await new Promise(setImmediate);
  assert.equal(h.button.disabled, true);
  assert.equal(h.button.textContent, "Deleting…");
  await h.click(); resolveDelete(); await deleting;
  assert.deepEqual(h.calls, ["sibling-a", "sibling-b", "own", "delete_simple_at_bat"]);
});

test("Back while delete confirmation is open closes only the overlay without deleting", async () => {
  const h = await deleteHarness();
  let close;
  h.sandbox.topOverlayId = () => "confirmation";
  h.sandbox.confirmDialog = () => new Promise((resolve) => { close = () => resolve(false); });
  h.sandbox.window.history.back = () => close();
  const pending = h.click();
  assert.equal(vm.runInContext('navigation.decision().type', h.sandbox), "close-overlay");
  vm.runInContext('navigation.back()', h.sandbox);
  await pending;
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.navigations, []);
});

test("a refresh while the confirmation is open cannot change which clips or at-bat are deleted", async () => {
  const h = await deleteHarness();
  h.sandbox.confirmDialog = async () => {
    vm.runInContext('state.report = { clipId: "other", entryId: "other-entry", entryClipIds: ["other", "other-sibling"] };', h.sandbox);
    return true;
  };
  const rpcArgs = [];
  h.sandbox.supabase.rpc = async (name, args) => { h.calls.push(name); rpcArgs.push(args); return { error: null }; };
  await h.click();
  assert.deepEqual(h.calls, ["sibling-a", "sibling-b", "own", "delete_simple_at_bat"]);
  assert.equal(JSON.stringify(rpcArgs), JSON.stringify([{ p_entry_id: "entry" }]));
});

test("a re-render while the confirmation is open puts the pending state on the live Delete button", async () => {
  const h = await deleteHarness();
  const live = { dataset: { action: "delete" }, disabled: false, textContent: "Delete at-bat", setAttribute() {} };
  h.node("simpleRoot").querySelector = (selector) => selector === '[data-action="delete"]' ? live : null;
  let resolveDelete;
  h.sandbox.deleteClip = (id) => { h.calls.push(id); return id === "sibling-a" ? new Promise((resolve) => { resolveDelete = resolve; }) : Promise.resolve(); };
  const deleting = h.click(); await new Promise(setImmediate);
  assert.equal(live.disabled, true);
  assert.equal(live.textContent, "Deleting…");
  await h.click(); resolveDelete(); await deleting;
  assert.deepEqual(h.calls, ["sibling-a", "sibling-b", "own", "delete_simple_at_bat"]);
});

test("a failed delete on a still-pending report resumes its refresh; offline after a partial delete never says nothing was deleted", async () => {
  const h = await deleteHarness({ failClip: "sibling-a" });
  vm.runInContext('state.report.status = "processing"; state.report.report = { state: "pending" };', h.sandbox);
  await h.click();
  assert.notEqual(vm.runInContext("reportRefreshTimer", h.sandbox), null);
  vm.runInContext("stopReportRefresh()", h.sandbox);
  const partial = await deleteHarness({ failClip: "sibling-b" });
  await partial.click();
  partial.sandbox.navigator.onLine = false;
  await partial.click();
  assert.equal(partial.snacks.at(-1), "You're offline. Try again when you're back online.");
  assert.deepEqual(partial.calls, ["sibling-a", "sibling-b"]);
});

test("Progress pill reads the top-level visible status even if current carries a stored record status", async () => {
  const h = await appHarness();
  h.sandbox.document.getElementById = (id) => ["thenVideo", "nowVideo"].includes(id) ? null : h.node(id);
  h.sandbox.payload = { playerName: "Synthetic", progress: { status: "still_showing", history: [],
    current: { concept: "front_side_stability", status: "active", startedAt: "2026-10-01", seen: 3, windowSize: 5 } } };
  await vm.runInContext("state.home = payload; showProgress()", h.sandbox);
  assert.match(h.node("simpleRoot").innerHTML, /bt-status-neutral">Still showing up</);
});

test("normal and experimental hide buttons open a Back-aware reason sheet and send selected reasons", async () => {
  for (const experimental of [false, true]) for (const reason of ["not_what_happened", "wrong_kid", "other"]) {
    const h = await appHarness();
    vm.runInContext('state.shared = false; state.tab = "report"; state.report = { clipId: "clip", report: { fix: { id: "issue" } } };', h.sandbox);
    const action = experimental ? { hideIssue: "issue" } : { action: "hide-fix" };
    await clickAction(h, action);
    assert.equal(vm.runInContext('navigation.sheet', h.sandbox), "hide");
    assert.equal(vm.runInContext('navigation.decision().type', h.sandbox), "close-sheet");
    await vm.runInContext('navigation.pop({ state: { hl: "tab", tab: "home" } })', h.sandbox);
    assert.equal(h.node("captureDialog").open, false);
    await clickAction(h, action);
    let sent;
    h.sandbox.supabase.functions.invoke = async (name, args) => { sent = { name, ...args.body }; return {}; };
    h.sandbox.window.history.go = () => queueMicrotask(() => vm.runInContext('navigation.pop({ state: { hl: "tab", tab: "home" } })', h.sandbox));
    h.sandbox.showReport = async () => {};
    h.sandbox.reportApi = async () => ({});
    await clickAction(h, { hideReason: reason }, true);
    assert.deepEqual(sent, { name: "hide-simple-issue", issueId: "issue", reason });
    assert.equal(h.snacks.at(-1), "Hidden for this report.");
  }
});

test("media errors refresh a URL once, then require an explicit retry; stale requests cannot swap videos", async () => {
  const h = await appHarness();
  const video = h.node("reportVideo");
  let fetches = 0;
  h.sandbox.reportApi = async () => { fetches++; return { videoUrl: `https://example.invalid/fresh-${fetches}` }; };
  vm.runInContext('state.tab = "report"; state.report = { clipId: "clip" }; prepareReportVideo("clip", "share-token");', h.sandbox);
  video.listeners.error(); await new Promise(setImmediate);
  assert.equal(fetches, 1);
  assert.equal(video.src, "https://example.invalid/fresh-1");
  video.listeners.error(); video.listeners.error();
  assert.equal(fetches, 1);
  assert.match(video.afterNode.innerHTML, /Video couldn't load\./);
  assert.match(video.afterNode.innerHTML, /Try again/);
  await clickAction(h, { action: "retry-video" });
  assert.equal(fetches, 2);
  video.listeners.error(); assert.equal(fetches, 2);
  let resolve;
  h.sandbox.reportApi = () => new Promise((done) => { resolve = done; });
  const retry = clickAction(h, { action: "retry-video" });
  vm.runInContext('stopReportRefresh()', h.sandbox);
  resolve({ videoUrl: "https://example.invalid/stale" }); await retry;
  assert.equal(video.src, "https://example.invalid/fresh-2");
});

test("a late error from the old URL during a refresh does not mark the fresh video as failed", async () => {
  const h = await appHarness();
  const video = h.node("reportVideo");
  let resolve;
  h.sandbox.reportApi = () => new Promise((done) => { resolve = done; });
  vm.runInContext('state.tab = "report"; state.report = { clipId: "clip" }; prepareReportVideo("clip", null);', h.sandbox);
  video.listeners.error();
  video.listeners.error();
  resolve({ videoUrl: "https://example.invalid/fresh" }); await new Promise(setImmediate);
  assert.equal(video.src, "https://example.invalid/fresh");
  assert.doesNotMatch(video.afterNode?.innerHTML ?? "", /Video couldn't load/);
});

test("a failed automatic URL fetch presents Try again without looping", async () => {
  const h = await appHarness();
  let calls = 0;
  h.sandbox.reportApi = async () => { calls++; throw new Error("private URL"); };
  vm.runInContext('state.tab = "report"; state.report = { clipId: "clip" }; prepareReportVideo("clip", null);', h.sandbox);
  h.node("reportVideo").listeners.error(); await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.match(h.node("reportVideo").afterNode.innerHTML, /Video couldn't load\./);
  assert.doesNotMatch(h.node("reportVideo").afterNode.innerHTML, /private/);
});


const syntheticPlayers = [{ id: "p", name: "Maya Sample", jersey_number: "12", slug: "maya-sample" }, { id: "q", name: "Alex Sample", jersey_number: "", slug: "alex-sample" }];
const shareFixture = { id: "link", share_scope: "report", players: { name: "Maya Sample" }, created_at: "2026-10-10", expires_at: "2099-01-08", video_clips: { game_log_entries: { date: "2026-10-14" } }, token: "NEVER_RENDER_SECRET" };
test("share rows classify expiry boundary, revocation, missing clip and unknown player without tokens", () => {
  const now = "2026-10-21";
  assert.equal(presentation.shareLinkState(shareFixture, now), "active");
  assert.equal(presentation.shareLinkState({ expires_at: now }, now), "expired");
  assert.equal(presentation.shareLinkState({ expires_at: now, revoked_at: "2026-10-12" }, now), "turned_off");
  const format = (date) => new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const rows = presentation.shareLinkRows([shareFixture, { ...shareFixture, expires_at: "2026-01-08", video_clips: null }, { ...shareFixture, share_scope: "progress", players: null, revoked_at: "2026-10-12" }], now, format);
  assert.equal(rows[0].title, "At-bat report · Maya Sample · Oct 14");
  assert.equal(rows[0].supporting, "Shared Oct 10 · Expires Jan 8");
  assert.deepEqual(rows[0].chip, { label: "Active", tone: "success" });
  assert.equal(rows[1].title, "At-bat report · Maya Sample");
  assert.equal(rows[1].supporting, "Expired Jan 8");
  assert.equal(rows[2].title, "Progress · Unknown player");
  assert.equal(rows[2].supporting, "Turned off Oct 12");
  assert.equal(presentation.shareLinkRows([{ ...shareFixture, players: null, video_clips: { game_log_entries: {} } }], now, format)[0].title, "At-bat report · Unknown player");
  assert.doesNotMatch(JSON.stringify(rows), /NEVER_RENDER_SECRET/);
});
test("Shared links uses one creator-only token-free read, sections, empty/error and Settings Back", async () => {
  const h = await coachHarness();
  const calls = database(h, { player_share_links: { data: [shareFixture, { ...shareFixture, id: "old", revoked_at: "2026-10-12" }] } });
  await vm.runInContext('settingsSheet();', h.sandbox);
  assert.match(h.node("captureSheet").innerHTML, /data-action="shared-links"/);
  await h.node("captureSheet").listeners.click({ target: { closest: () => ({ dataset: { action: "shared-links" } }) } });
  const reads = calls.filter((c) => c.table === "player_share_links");
  assert.equal(reads.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(reads[0].methods)), [["select", "id, player_id, share_scope, video_clip_id, created_at, expires_at, revoked_at, players(name), video_clips(game_log_entries(date, session_type))"], ["eq", "created_by", "coach"], ["not", "share_scope", "is", null], ["order", "created_at", { ascending: false }], ["limit", 50]]);
  assert.doesNotMatch(reads[0].methods[0][1], /token/);
  const html = h.node("captureSheet").innerHTML;
  assert.doesNotMatch(html, /NEVER_RENDER_SECRET/);
  assert.match(html, /<h3>Active/); assert.match(html, /Expired or turned off/);
  assert.equal((html.match(/data-action="turn-off-link"/g) ?? []).length, 1);
  assert.equal(vm.runInContext('navigation.decision().name', h.sandbox), "settings");
  await vm.runInContext('navigation.pop({ state: { hl: "sheet", name: "settings" } })', h.sandbox);
  assert.match(h.node("captureSheet").innerHTML, />Settings</);
  database(h); await vm.runInContext('sharedLinksSheet()', h.sandbox);
  assert.match(h.node("captureSheet").innerHTML, /You haven't shared any links yet/);
  database(h, { player_share_links: { error: new Error("private SQL") } });
  await vm.runInContext('sharedLinksSheet()', h.sandbox);
  assert.match(h.node("captureSheet").innerHTML, /Couldn't load shared links. Try again./);
  assert.doesNotMatch(h.node("captureSheet").innerHTML, /private SQL/);
});
test("parent, demo and shared viewers cannot render or run coach management", async () => {
  for (const setup of ['state.role = "parent"', 'state.demo = true', 'state.shared = true']) {
    const h = await coachHarness(); const calls = database(h);
    h.sandbox.getDemoConfig = () => ({ returnUrl: "/" });
    h.sandbox.action = { dataset: { linkId: "link" } };
    vm.runInContext(setup, h.sandbox);
    await vm.runInContext('settingsSheet()', h.sandbox);
    assert.doesNotMatch(h.node("captureSheet").innerHTML, /data-action="shared-links"/);
    await vm.runInContext('sharedLinksSheet(); turnOffLink(action); deletePlayer(action); editPlayerId = "p"; editPlayerSheet(); savePlayerDetails(action); openCoachClip("clip")', h.sandbox);
    assert.equal(vm.runInContext('playerDetailsCard("p")', h.sandbox), "");
    assert.equal(calls.some((c) => ["player_share_links", "players", "video_clips"].includes(c.table)), false);
    assert.equal(h.rpcs.length, 0);
  }
});
test("Turn off confirms, ignores repeats, reloads, cancels and handles errors safely", async () => {
  const h = await coachHarness(); const calls = database(h, { player_share_links: { data: [shareFixture] } });
  await vm.runInContext('sharedLinksSheet()', h.sandbox);
  h.sandbox.action = { dataset: { linkId: "link" } };
  h.sandbox.action.dataset.action = "turn-off-link";
  await h.node("captureSheet").listeners.click({ target: { closest: () => h.sandbox.action } });
  assert.equal(h.rpcs.length, 0);
  assert.equal(h.confirms[0].title, "Turn off this link?");
  let release; h.sandbox.confirmDialog = () => new Promise((r) => { release = r; });
  const pending = vm.runInContext('turnOffLink(action)', h.sandbox);
  await vm.runInContext('turnOffLink(action)', h.sandbox);
  assert.equal(h.sandbox.action.disabled, true); release(true); await pending;
  assert.equal(h.rpcs.length, 1); assert.equal(h.rpcs[0][0], "revoke_simple_share_link");
  assert.equal(h.rpcs[0][1].p_link_id, "link");
  assert.equal(calls.filter((c) => c.table === "player_share_links").length, 2);
  assert.equal(h.snacks.at(-1), "Link turned off.");
  h.sandbox.confirmDialog = async () => true;
  h.sandbox.supabase.rpc = async () => ({ error: new Error("private") });
  await vm.runInContext('turnOffLink(action)', h.sandbox);
  assert.equal(h.snacks.at(-1), "Couldn't turn off the link. Try again.");
  assert.equal(h.sandbox.action.disabled, false);
});
test("Player details summary, required fields, prefill, scoped payload without slug and friendly error", async () => {
  assert.equal(presentation.playerDetailsSummary({ jersey_number: "8", age_band: "8-10", bats: "R", throws: "R" }), "#8 · Age 8–10 · Bats right · Throws right");
  assert.match(presentation.playerDetailsSummary({}), /Age band unknown · Bats unknown · Throws unknown/);
  const h = await coachHarness(); const calls = database(h, { players: { data: syntheticPlayers } });
  await vm.runInContext('navigation.openPlayer("p")', h.sandbox);
  const html = h.node("simpleRoot").innerHTML;
  assert.ok(html.indexOf('id="playerDetailsCard"') > html.indexOf('id="parentsCard"'));
  vm.runInContext('editPlayerId = "p"; editPlayerSheet()', h.sandbox);
  assert.match(h.node("captureSheet").innerHTML, /value="Maya Sample"/);
  h.sandbox.action = {};
  for (const id of ["Name", "Jersey", "Age", "Bats", "Throws"]) h.node(`editPlayer${id}`).value = "";
  h.sandbox.action.dataset = { action: "save-player-details" };
  await h.node("captureSheet").listeners.click({ target: { closest: () => h.sandbox.action } });
  assert.equal(h.node("editPlayerError").textContent, "Enter a player name.");
  h.node("editPlayerName").value = " Updated ";
  await vm.runInContext('savePlayerDetails(action)', h.sandbox);
  assert.equal(h.node("editPlayerError").textContent, "Enter a jersey number.");
  h.node("editPlayerJersey").value = "8"; h.node("editPlayerAge").value = "8-10"; h.node("editPlayerBats").value = "S"; h.node("editPlayerThrows").value = "L";
  await vm.runInContext('savePlayerDetails(action)', h.sandbox);
  const update = calls.find((c) => c.methods[0][0] === "update");
  assert.deepEqual(JSON.parse(JSON.stringify(update.methods)), [["update", { name: "Updated", jersey_number: "8", age_band: "8-10", bats: "S", throws: "L" }], ["eq", "id", "p"], ["eq", "team_id", "team"]]);
  assert.equal(h.snacks.at(-1), "Player details saved.");
  vm.runInContext('editPlayerSheet()', h.sandbox);
  database(h, { players: { error: new Error("private") } });
  await vm.runInContext('savePlayerDetails(action)', h.sandbox);
  assert.equal(h.node("editPlayerError").textContent, "Couldn't save player details. Try again.");
});
test("Delete player cancels, fails closed per phase, snapshots targets and ignores repeats", async () => {
  for (const outcome of ["cancel", "clip", "row", "success"]) {
    const h = await coachHarness(); const clips = []; const navigation = [];
    const calls = database(h, { players: (call) => call.methods[0][0] === "delete" && outcome === "row" ? { error: new Error("private") } : { data: syntheticPlayers } });
    h.sandbox.action = {}; h.sandbox.navigate = (tab) => navigation.push(tab);
    vm.runInContext('navigation.goTab = async (tab) => navigate(tab)', h.sandbox);
    let release; h.sandbox.confirmDialog = (options) => { h.confirms.push(options); return new Promise((r) => { release = r; }); };
    h.sandbox.deleteClipsForPlayer = async (id) => { clips.push(id); if (outcome === "clip") throw new Error("private"); };
    const pending = vm.runInContext('deletePlayer(action)', h.sandbox);
    const replacement = { disabled: true, textContent: "Deleting…" };
    h.node("simpleRoot").querySelectorAll = () => [replacement];
    await vm.runInContext('deletePlayer(action); state.selected = "q"', h.sandbox);
    release(outcome !== "cancel"); await pending;
    assert.equal(h.confirms.length, 1); assert.equal(h.confirms[0].title, "Delete Maya Sample?");
    assert.deepEqual(clips, outcome === "cancel" ? [] : ["p"]);
    const deletes = calls.filter((c) => c.methods[0][0] === "delete");
    assert.equal(deletes.length, ["row", "success"].includes(outcome) ? 1 : 0);
    if (deletes.length) assert.deepEqual(deletes[0].methods, [["delete"], ["eq", "id", "p"], ["eq", "team_id", "team"]]);
    assert.deepEqual(navigation, outcome === "success" ? ["home"] : []);
    if (outcome === "clip") assert.equal(h.snacks.at(-1), "Couldn't delete all of this player's videos, so the player wasn't deleted. Try again.");
    if (outcome === "row") assert.equal(h.snacks.at(-1), "Videos were deleted, but the player couldn't be removed. Try again.");
    if (outcome === "success") assert.equal(h.snacks.at(-1), "Player deleted.");
    assert.equal(h.sandbox.action.disabled, false);
    assert.equal(replacement.disabled, false);
  }
});
test("start resolves coach clip-only links once through RLS; invalid links never guess from feed", async () => {
  for (const outcome of ["resolved", "missing", "foreign", "error", "parent", "invalid-player", "empty-roster"]) {
    const h = await coachHarness();
    h.sandbox.supabase.auth.getSession = async () => ({ data: { session: { user: { id: "user" } } } });
    const calls = database(h, {
      coach_team_access: { data: outcome === "parent" ? [] : [{ team_id: "team", teams: { name: "Fictional Team" } }] },
      players: { data: outcome === "empty-roster" ? [] : syntheticPlayers }, player_guardians: { data: [{ player_id: "p", consent_version: "v" }] },
      user_settings: { data: { notify_reports: false } },
      video_clips: outcome === "error" ? { error: new Error("private") } : { data: outcome === "missing" ? null : { id: "clip", game_log_entries: { player_id: outcome === "foreign" ? "foreign" : "q" } } },
    });
    h.sandbox.supabase.rpc = async () => ({ data: "v" });
    h.sandbox.localStorage = { getItem: () => "1" }; h.sandbox.drainCaptureQueue = () => {};
    h.sandbox.homePayload.feed = [{ id: "clip", status: "ready" }];
    h.sandbox.payload = { clipId: "clip", playerName: "Alex Sample", status: "ready", presentation: baselinePresentation({ status: "ready", report: { state: "no_swing" } }), report: { state: "no_swing" } };
    vm.runInContext('params.delete("share"); params.set("clip", "clip"); reportApi = async (id, clip) => clip ? payload : homePayload; loadCaptureSummary = async () => {};', h.sandbox);
    if (outcome === "invalid-player") vm.runInContext('params.set("player", "foreign")', h.sandbox);
    await vm.runInContext('start()', h.sandbox);
    const reads = calls.filter((c) => c.table === "video_clips");
    assert.equal(reads.length, outcome === "parent" ? 0 : 1);
    if (reads.length) assert.deepEqual(reads[0].methods, [["select", "id, game_log_entries!inner(player_id)"], ["eq", "id", "clip"], ["maybeSingle"]]);
    if (["resolved", "invalid-player"].includes(outcome)) {
      assert.equal(vm.runInContext('navigation.view.hl', h.sandbox), "report");
      assert.equal(vm.runInContext('navigation.view.parent.playerId', h.sandbox), "q");
      await vm.runInContext('navigation.pop({ state: navigation.view.parent })', h.sandbox);
      assert.equal(vm.runInContext('navigation.view.hl', h.sandbox), "player");
    } else {
      assert.equal(vm.runInContext('navigation.view.hl', h.sandbox), "tab");
      if (outcome !== "parent") assert.equal(h.snacks.at(-1), "That at-bat isn't available.");
    }
  }
});
function database(h, responses = {}) {
  const calls = [];
  h.sandbox.supabase.from = (table) => {
    const call = { table, methods: [] }; calls.push(call);
    const query = { then(resolve, reject) { return Promise.resolve(typeof responses[table] === "function" ? responses[table](call) : responses[table] ?? { data: [], error: null }).then(resolve, reject); } };
    for (const method of ["select", "eq", "in", "order", "is", "gt", "insert", "update", "delete", "not", "limit", "maybeSingle"]) query[method] = (...args) => { call.methods.push([method, ...args]); return query; };
    return query;
  };
  return calls;
}
async function coachHarness() {
  const h = await appHarness();
  const getNode = h.sandbox.document.getElementById;
  h.sandbox.document.getElementById = (id) => ["thenVideo", "nowVideo"].includes(id) ? null : getNode(id);
  h.sandbox.players = syntheticPlayers;
  h.sandbox.queuedCaptures = async () => [];
  h.sandbox.homePayload = { playerName: "Maya Sample", feed: [], progress: { status: "early_read", history: [] } };
  vm.runInContext('state.shared = false; state.role = "coach"; state.teamId = "team"; state.teamName = "Fictional Team"; state.players = players; state.selected = "p"; state.userId = "coach"; reportApi = async () => homePayload;', h.sandbox);
  h.sandbox.window.history.go = () => queueMicrotask(() => vm.runInContext('navigation.pop({ state: { hl: "tab", tab: "home" } })', h.sandbox));
  return h;
}

test("roster summary uses latest game only, ignores deleting clips, and never guesses focus", () => {
  const entries = [
    { player_id: "p", date: "2026-10-11", session_type: "game", video_clips: [{ status: "processing" }, { status: "failed" }] },
    { player_id: "p", date: "2026-10-12", session_type: "practice", video_clips: [{ status: "ready" }] },
    { player_id: "p", date: "2026-10-10", session_type: "game", video_clips: [{ status: "failed" }] },
  ];
  const summary = presentation.rosterSummary(syntheticPlayers, entries);
  assert.deepEqual(summary.p, { text: "Last at-bat Oct 11", status: { label: "Analyzing", tone: "neutral" } });
  assert.deepEqual(summary.q, { text: "No at-bats yet", status: null });
  for (const [statuses, label] of [[["failed", "unreadable", "deletion_pending"], "Couldn't analyze"], [["ready", "failed"], null], [["deletion_pending"], null], [[], null], [["pending"], "Analyzing"]]) {
    const value = presentation.rosterSummary(syntheticPlayers, [{ ...entries[0], video_clips: statuses.map((status) => ({ status })) }]);
    assert.equal(value.p.status?.label ?? null, label);
    assert.equal("focus" in value.p, false);
  }
});

test("Team shows loading rows then one batched summary read for all players; errors omit summaries", async () => {
  const h = await coachHarness(); let resolve;
  const calls = database(h, { game_log_entries: () => new Promise((r) => { resolve = r; }) });
  const rendering = vm.runInContext('showHome()', h.sandbox);
  await new Promise((r) => setImmediate(r));
  assert.match(h.node("simpleRoot").innerHTML, /Loading…/);
  assert.match(h.node("simpleRoot").innerHTML, /jersey-badge sm/);
  resolve({ data: [] }); await rendering;
  assert.equal(calls.filter((c) => c.table === "game_log_entries").length, 1);
  assert.deepEqual(Array.from(calls[0].methods.find(([m]) => m === "in")[2]), ["p", "q"]);
  const html = h.node("simpleRoot").innerHTML;
  assert.ok(html.indexOf("Alex Sample") < html.indexOf("Maya Sample"));
  assert.match(html, /No at-bats yet/); assert.match(html, /data-player-menu/);
  database(h, { game_log_entries: { error: new Error("private SQL") } });
  await vm.runInContext('showHome()', h.sandbox);
  assert.match(h.node("simpleRoot").innerHTML, /Latest at-bats couldn't load/);
  assert.doesNotMatch(h.node("simpleRoot").innerHTML, /No at-bats yet|Loading|private SQL/);
  assert.equal(vm.runInContext('homeRefreshTimer', h.sandbox), null);
});

test("empty Team stays in-app and parents/demo never get coach controls", async () => {
  const h = await coachHarness(); database(h);
  await vm.runInContext('state.players = []; showHome()', h.sandbox);
  assert.match(h.node("simpleRoot").innerHTML, /No players yet/);
  assert.match(h.node("simpleRoot").innerHTML, /Import your roster from GameChanger/);
  for (const role of ["parent", "demo"]) {
    await vm.runInContext(`state.players = players; state.role = "${role === "demo" ? "coach" : "parent"}"; state.demo = ${role === "demo"}; state.home = homePayload; showHome()`, h.sandbox);
    const html = h.node("simpleRoot").innerHTML;
    assert.doesNotMatch(html, /data-open-player|data-player-menu|Import players|Add player|<h2>Parents/);
    assert.equal(vm.runInContext('teamSettingsHtml()', h.sandbox), "");
    if (role === "demo") assert.match(html, /Open full report/);
  }
  const source = await readFile(new URL("./simpleApp.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /team\.html/);
});

test("Add player validates, maps duplicates and reloads the roster with unique slug on success", async () => {
  const h = await coachHarness(); const button = { disabled: false }; h.sandbox.saveButton = button;
  vm.runInContext('addPlayerSheet()', h.sandbox);
  assert.equal(vm.runInContext('navigation.sheet', h.sandbox), "add-player");
  for (const id of ["newPlayerName", "newPlayerJersey", "newPlayerAge", "newPlayerBats", "newPlayerThrows"]) h.node(id).value = "";
  await vm.runInContext('savePlayer(saveButton)', h.sandbox);
  assert.equal(h.node("addPlayerError").textContent, "Enter a player name.");
  h.node("newPlayerName").value = "Maya Sample";
  await vm.runInContext('savePlayer(saveButton)', h.sandbox);
  assert.equal(h.node("addPlayerError").textContent, "Enter a jersey number.");
  h.node("newPlayerJersey").value = "8";
  database(h, { players: { error: { code: "23505", message: "private" } } });
  await vm.runInContext('savePlayer(saveButton)', h.sandbox);
  assert.equal(h.node("addPlayerError").textContent, "A player with that name already exists on this team.");
  const calls = database(h, { players: { data: syntheticPlayers } });
  await vm.runInContext('savePlayer(saveButton)', h.sandbox);
  const insert = calls[0].methods.find(([m]) => m === "insert")[1];
  assert.equal(insert.slug, "maya-sample-2"); assert.equal(insert.team_id, "team");
  assert.ok(calls.some((c) => c.methods.some(([m, columns]) => m === "select" && columns === "id, name, jersey_number, slug, age_band, bats, throws")));
  assert.equal(button.disabled, false); assert.equal(h.snacks.at(-1), "Player added.");
});

test("Import reuses existing overlay with team and roster, then reloads and announces results", async () => {
  const h = await coachHarness(); database(h, { players: { data: syntheticPlayers } }); let options;
  h.sandbox.openRosterImportSheet = (value) => { options = value; };
  vm.runInContext('importPlayers()', h.sandbox);
  assert.equal(options.teamId, "team"); assert.equal(options.existing.length, 2);
  await options.onDone({ created: 3, updated: 1 });
  assert.equal(h.snacks.at(-1), "Imported 3 players; updated 1 jersey number. Invite parents from each player's screen.");
});

test("Player loads parent rows and pending invites, with friendly load failure and working Back", async () => {
  const h = await coachHarness();
  const calls = database(h, { player_guardians: { data: [{ user_id: "g", relationship: "parent", consented_at: "2026-10-01" }] }, guardian_invites: { data: [{ expires_at: "2099-10-30" }] } });
  await vm.runInContext('navigation.openPlayer("p")', h.sandbox);
  assert.match(h.node("simpleRoot").innerHTML, /Back to Team/);
  assert.match(h.node("parentsCard").innerHTML, /Guardian 1/);
  assert.match(h.node("parentsCard").innerHTML, /1 invite not used yet/);
  assert.ok(calls.find((c) => c.table === "guardian_invites").methods.some(([m, field]) => m === "gt" && field === "expires_at"));
  database(h, { player_guardians: { error: new Error("private") } });
  await vm.runInContext('loadParents("p")', h.sandbox);
  assert.match(h.node("parentsCard").innerHTML, /Couldn't load parents/);
  assert.doesNotMatch(h.node("parentsCard").innerHTML, /private/);
  h.sandbox.reportApi = async () => { throw new Error("raw transport"); };
  await vm.runInContext('showPlayer("p")', h.sandbox);
  assert.match(h.node("simpleRoot").innerHTML, /Try again/);
  assert.match(h.node("simpleRoot").innerHTML, /Back to Team/);
  assert.doesNotMatch(h.node("simpleRoot").innerHTML, /raw transport/);
});

test("parent cancellation and removal confirm immutable player targets, map errors and unlock buttons", async () => {
  const h = await coachHarness(); database(h, { guardian_invites: { data: [{ expires_at: "2099-10-30" }] } });
  h.sandbox.actionButton = { disabled: false, dataset: { invitePlayer: "p", userId: "g", label: "Guardian 1" } };
  await vm.runInContext('cancelInvites("p", actionButton)', h.sandbox);
  await vm.runInContext('removeGuardian(actionButton)', h.sandbox);
  assert.equal(h.rpcs.length, 0);
  h.sandbox.confirmDialog = async (opts) => { h.confirms.push(opts); return true; };
  await vm.runInContext('cancelInvites("p", actionButton)', h.sandbox);
  await vm.runInContext('removeGuardian(actionButton)', h.sandbox);
  assert.equal(h.rpcs[0][0], "revoke_guardian_invites"); assert.equal(h.rpcs[1][0], "revoke_guardian");
  assert.equal(h.rpcs[1][1].p_user_id, "g"); assert.equal(h.snacks.at(-1), "Parent removed.");
  h.sandbox.supabase.rpc = async () => ({ error: new Error("private") });
  await vm.runInContext('cancelInvites("p", actionButton)', h.sandbox);
  assert.equal(h.snacks.at(-1), "Couldn't cancel the invites. Try again.");
  await vm.runInContext('removeGuardian(actionButton)', h.sandbox);
  assert.equal(h.snacks.at(-1), "Couldn't remove the parent. Try again.");
  assert.equal(h.sandbox.actionButton.disabled, false);
});

test("coach Progress switches players and Team settings persist existing team fields only", async () => {
  const h = await coachHarness(); const calls = database(h);
  await vm.runInContext('state.home = homePayload; showProgress()', h.sandbox);
  assert.match(h.node("simpleRoot").innerHTML, /aria-label="Choose a player"/);
  await h.node("simpleRoot").listeners.click({ target: { closest: () => ({ dataset: { progressPlayer: "q" } }) } });
  assert.equal(vm.runInContext('state.selected', h.sandbox), "q");
  assert.match(h.node("simpleRoot").innerHTML, /data-progress-player="q" aria-pressed="true"/);
  assert.match(vm.runInContext('teamSettingsHtml()', h.sandbox), /Legacy coach tools/);
  h.node("teamSport").value = "softball"; h.node("teamLevel").value = "12U"; h.sandbox.saveButton = {};
  await vm.runInContext('saveTeam(saveButton)', h.sandbox);
  assert.equal(vm.runInContext('state.guideSport', h.sandbox), "softball");
  assert.equal(calls[0].table, "teams"); assert.equal(h.snacks.at(-1), "Team details saved.");
});

test("background feed refresh never navigates away and coach Team does not poll", async () => {
  const h = await coachHarness(); database(h); let resolve;
  await vm.runInContext('navigation.openPlayer("p")', h.sandbox);
  h.sandbox.reportApi = () => new Promise((r) => { resolve = r; });
  const refresh = vm.runInContext('refreshHome()', h.sandbox);
  vm.runInContext('state.tab = "progress"', h.sandbox);
  resolve({ playerName: "Late", feed: [] }); await refresh;
  assert.equal(vm.runInContext('state.tab', h.sandbox), "progress");
  vm.runInContext('state.tab = "home"; state.home = { feed: [{ status: "pending" }] }; scheduleHomeRefresh()', h.sandbox);
  assert.equal(vm.runInContext('homeRefreshTimer', h.sandbox), null);
});


test("start keeps role precedence, labels Team/Home, and opens coach player/report deep links in order", async () => {
  for (const coach of [true, false]) {
    const h = await coachHarness();
    h.sandbox.supabase.auth.getSession = async () => ({ data: { session: { user: { id: "user" } } } });
    database(h, {
      coach_team_access: { data: coach ? [{ team_id: "team", teams: { name: "Fictional Team", slug: "fictional", sport: "softball" } }] : [] },
      players: { data: syntheticPlayers }, player_guardians: { data: [{ player_id: "p", consent_version: "v" }] },
      user_settings: { data: { notify_reports: false } },
    });
    h.sandbox.supabase.rpc = async () => ({ data: "v" });
    h.sandbox.localStorage = { getItem: () => "1" }; h.sandbox.drainCaptureQueue = () => {};
    h.sandbox.homePayload.feed = []; // Deep links must also open reports older than the feed window.
    h.sandbox.payload = { clipId: "clip", playerName: "Maya Sample", status: "ready", presentation: baselinePresentation({ status: "ready", report: { state: "no_swing" } }), report: { state: "no_swing" } };
    vm.runInContext('params.delete("share"); params.set("player", "p"); params.set("clip", "clip"); reportApi = async (id, clip) => clip ? payload : homePayload; loadCaptureSummary = async () => {};', h.sandbox);
    await vm.runInContext('start()', h.sandbox);
    assert.equal(vm.runInContext('state.role', h.sandbox), coach ? "coach" : "parent");
    assert.equal(h.node('.simple-nav [data-tab="home"]').textContent, coach ? "Team" : "Home");
    if (coach) {
      assert.equal(vm.runInContext('navigation.view.hl', h.sandbox), "report");
      assert.equal(vm.runInContext('navigation.view.parent.playerId', h.sandbox), "p");
      assert.match(h.node("simpleRoot").innerHTML, /Back to Maya/);
    } else {
      assert.equal(vm.runInContext('navigation.view.hl', h.sandbox), "tab");
      assert.doesNotMatch(h.node("simpleRoot").innerHTML, /Players|Import players|Add player|Parents/);
    }
  }
});

test("successful send lands coach on sent Player and parent on Home", async () => {
  for (const coach of [true, false]) {
    const h = await coachHarness(); database(h);
    h.node("capturePlayer").value = "q";
    h.sandbox.enqueueCapture = async () => {}; h.sandbox.drainCaptureQueue = () => {};
    h.sandbox.sendButton = { disabled: false };
    vm.runInContext(`state.role = "${coach ? "coach" : "parent"}"; state.files = [];`, h.sandbox);
    await vm.runInContext('sendCaptures(sendButton)', h.sandbox);
    assert.equal(vm.runInContext('state.selected', h.sandbox), "q");
    assert.equal(vm.runInContext('navigation.view.hl', h.sandbox), coach ? "player" : "tab");
    assert.equal(vm.runInContext('state.tab', h.sandbox), coach ? "player" : "home");
  }
});

test("successful report deletion uses actual parent navigation for coaches and parents", async () => {
  for (const coach of [true, false]) {
    const h = await coachHarness(); database(h);
    h.sandbox.confirmDialog = async () => true; h.sandbox.deleteClip = async () => {};
    h.sandbox.deleteButton = { disabled: false, setAttribute() {} };
    if (coach) await vm.runInContext('navigation.openPlayer("p")', h.sandbox);
    else vm.runInContext('state.role = "parent"', h.sandbox);
    vm.runInContext('navigation.openReport("clip"); state.tab = "report"; state.report = { clipId: "clip", entryId: "entry" };', h.sandbox);
    await vm.runInContext('deleteReport(deleteButton)', h.sandbox);
    assert.equal(vm.runInContext('navigation.view.hl', h.sandbox), coach ? "player" : "tab");
    assert.equal(vm.runInContext('state.tab', h.sandbox), coach ? "player" : "home");
    assert.equal(h.snacks.at(-1), "At-bat deleted.");
  }
});

test("late Progress and Player responses do not replace a different screen", async () => {
  const h = await coachHarness(); database(h); let resolve;
  h.sandbox.reportApi = () => new Promise((r) => { resolve = r; });
  const progress = vm.runInContext('state.home = null; showProgress()', h.sandbox);
  await vm.runInContext('showHome()', h.sandbox);
  resolve(h.sandbox.homePayload); await progress;
  assert.match(h.node("simpleRoot").innerHTML, /<h2>Players/);
  const player = vm.runInContext('showPlayer("p")', h.sandbox);
  await vm.runInContext('showHome()', h.sandbox);
  resolve(h.sandbox.homePayload); await player;
  assert.match(h.node("simpleRoot").innerHTML, /<h2>Players/);
});

test("Progress without a linked player shows a plain message; a shared progress link without a player id still renders", async () => {
  const h = await appHarness();
  h.sandbox.document.getElementById = (id) => ["thenVideo", "nowVideo"].includes(id) ? null : h.node(id);
  let calls = 0;
  h.sandbox.reportApi = async () => { calls++; throw new Error("should not fetch"); };
  await vm.runInContext('state.role = "parent"; state.shared = false; state.selected = null; state.home = null; showProgress()', h.sandbox);
  assert.match(h.node("simpleRoot").innerHTML, /Ask your child's coach for an invite link\./);
  assert.equal(calls, 0);
  h.sandbox.payload = { playerName: "Synthetic", progress: { status: "early_read", current: null, history: [] } };
  await vm.runInContext('state.shared = true; state.selected = null; state.home = payload; showProgress()', h.sandbox);
  assert.match(h.node("simpleRoot").innerHTML, /bt-status-neutral">Early read</);
});

test("roster summary dates use the formatter the app passes", () => {
  const value = presentation.rosterSummary([{ id: "p1" }], [{ player_id: "p1", date: "2026-10-11", session_type: "game", video_clips: [] }], (date) => `formatted ${date}`);
  assert.equal(value.p1.text, "Last at-bat formatted 2026-10-11");
});

test("an empty coach account's Progress says to add a player without fetching", async () => {
  const h = await appHarness();
  let calls = 0;
  h.sandbox.reportApi = async () => { calls++; throw new Error("should not fetch"); };
  await vm.runInContext('state.role = "coach"; state.shared = false; state.demo = false; state.teamName = "Fixture Team"; state.players = []; state.selected = null; state.home = null; showProgress()', h.sandbox);
  assert.match(h.node("simpleRoot").innerHTML, /Add a player to see progress\./);
  assert.match(h.node("simpleRoot").innerHTML, /Fixture Team/);
  assert.equal(calls, 0);
});

test("Shared links with no active link says so and still lists expired or turned-off links", async () => {
  const h = await coachHarness();
  database(h, { player_share_links: { data: [{ ...shareFixture, id: "old", revoked_at: "2026-10-12" }] } });
  await vm.runInContext('settingsSheet()', h.sandbox);
  await vm.runInContext('sharedLinksSheet()', h.sandbox);
  const html = h.node("captureSheet").innerHTML;
  assert.match(html, /No active links\./);
  assert.match(html, /Expired or turned off/);
  assert.doesNotMatch(html, /data-action="turn-off-link"/);
});

test("a deleted player is reported as deleted even if the roster refresh afterwards fails", async () => {
  const h = await coachHarness(); const navigation = [];
  database(h, { players: (call) => call.methods[0][0] === "select" && h.sandbox.afterDelete ? { error: new Error("private") } : { data: syntheticPlayers } });
  h.sandbox.action = {}; h.sandbox.navigate = (tab) => navigation.push(tab);
  vm.runInContext('state.selected = "p"; navigation.goTab = async (tab) => navigate(tab)', h.sandbox);
  h.sandbox.confirmDialog = async () => true;
  h.sandbox.deleteClipsForPlayer = async () => { h.sandbox.afterDelete = true; };
  await vm.runInContext('deletePlayer(action)', h.sandbox);
  assert.deepEqual(navigation, ["home"]);
  assert.equal(h.snacks.at(-1), "Player deleted.");
  assert.equal(vm.runInContext('state.players.some((p) => p.id === "p")', h.sandbox), false);
});
test("Add player and Edit details show readable age-band labels and keep the stored values", async () => {
  const h = await coachHarness(); database(h, { players: { data: syntheticPlayers } });
  for (const open of ['addPlayerSheet()', 'editPlayerId = "p"; editPlayerSheet()']) {
    vm.runInContext(open, h.sandbox);
    const html = h.node("captureSheet").innerHTML;
    assert.match(html, /<option value="u8" >Under 8<\/option>|<option value="u8"\s*>Under 8<\/option>/);
    assert.match(html, /value="8-10"[^>]*>8–10</);
    assert.doesNotMatch(html, />u8</);
  }
});

test("UI-PR6 parser validates every field, freezes copies, and rejects malformed contracts", () => {
  const valid = readyPayload().presentation;
  const parsed = presentation.parsePresentation(valid);
  assert.ok(parsed); assert.ok(Object.isFrozen(parsed)); assert.ok(Object.isFrozen(parsed.reasonCodes));
  assert.notEqual(parsed.reasonCodes, valid.reasonCodes);
  for (const key of Object.keys(valid)) {
    const missing = { ...valid }; delete missing[key];
    assert.equal(presentation.parsePresentation(missing), null, key);
    for (const bad of [undefined, {}, 42, ...(key === "reasonCodes" ? [] : [[]])]) assert.equal(presentation.parsePresentation({ ...valid, [key]: bad }), null, key);
  }
  for (const bad of [null, [], "ready", { ...valid, version: 2 }, { ...valid, reasonCodes: [42] }, { ...valid, reasonCodes: Array(1) },
    { ...valid, limited: true }, { ...valid, strengthsState: "replaced_after_feedback" },
    { ...valid, summaryState: "none_found" }, { ...valid, momentLabel: "contact_confirmed" },
    ...["engine", "analysisState", "fixState", "strengthsState", "summaryState", "familyReason"].map(key => ({ ...valid, [key]: "invented" }))])
    assert.equal(presentation.parsePresentation(bad), null);
  assert.deepEqual(presentation.presentationCopy(null), { title: "This report can't be shown right now", body: "Try again later. The video is still here." });
});

test("UI-PR6 report states render contract copy, tips and actions independent of legacy state", async () => {
  const h = await appHarness();
  vm.runInContext('state.shared = false; loadCaptureSummary = async () => {}; loadCoachAnalysisAction = async () => {}; scheduleReportRefresh = () => {};', h.sandbox);
  const base = readyPayload().presentation;
  for (const [analysisState, familyReason, title, tip] of [
    ["processing", null, "Analyzing", false], ["no_swing", null, "No swing to analyze", false],
    ["insufficient_evidence", null, copy.unavailableTitle, true],
    ["unable_to_analyze", "batter_unclear", copy.unavailableTitle, true],
    ["unable_to_analyze", "swing_unclear", copy.unavailableTitle, true],
    ["unable_to_analyze", "clip_too_short", copy.unavailableTitle, true],
    ["unable_to_analyze", "video_blurry", copy.unavailableTitle, true],
    ["unable_to_analyze", "duration_limit", copy.durationTitle, false],
    ["unable_to_analyze", "not_enabled", copy.unavailableTitle, false],
    ["technical_failure", "unknown", copy.technicalTitle, false],
    ["supported_finding", null, "Synthetic issue", false],
    ["no_supported_issue", null, "One thing to work on", false],
    ["limited", null, "Limited analysis:", false],
  ]) {
    h.sandbox.payload = { ...readyPayload(), presentation: { ...base, analysisState, familyReason, limited: analysisState === "limited" } };
    await vm.runInContext('showReport("clip", null, payload)', h.sandbox);
    const html = h.node("simpleRoot").innerHTML;
    assert.ok(html.includes(title), analysisState); assert.match(html, /<video/); assert.match(html, /Delete at-bat/);
    assert.equal(html.includes("How to film next time"), tip, analysisState);
    assert.equal(html.includes("How it went"), ["supported_finding", "no_supported_issue", "limited"].includes(analysisState));
    assert.equal(html.includes('class="simple-status-line" role="note"'), analysisState === "limited");
  }
  for (const invalid of [undefined, null, {}, { ...base, analysisState: "invented" }]) {
    h.sandbox.payload = { ...readyPayload(), presentation: invalid };
    await vm.runInContext('showReport("clip", null, payload)', h.sandbox);
    const html = h.node("simpleRoot").innerHTML;
    assert.ok(html.includes(presentation.PRESENTATION_COPY.fallbackTitle)); assert.ok(html.includes(presentation.PRESENTATION_COPY.fallbackBody));
    assert.match(html, /<video/); assert.match(html, /Delete at-bat/); assert.doesNotMatch(html, /How it went|Synthetic issue|What looked good|How to film next time/);
  }
});

test("UI-PR6 sections use fix and strength states; shared viewers have no write controls", async () => {
  const h = await appHarness();
  vm.runInContext('loadCaptureSummary = async () => {}; loadCoachAnalysisAction = async () => {};', h.sandbox);
  for (const shared of [false, true]) for (const fixState of ["shown", "none_found", "not_confident", "hidden_after_feedback", "withheld_evidence"]) {
    h.sandbox.payload = readyPayload();
    h.sandbox.payload.presentation = { ...h.sandbox.payload.presentation, fixState, strengthsState: "none_found" };
    vm.runInContext(`state.shared = ${shared}`, h.sandbox);
    await vm.runInContext('showReport("clip", null, payload)', h.sandbox);
    const html = h.node("simpleRoot").innerHTML;
    assert.ok(html.includes(copy.strengthsNone)); assert.doesNotMatch(html, /Synthetic strength/);
    if (fixState === "shown") assert.match(html, /Synthetic issue/);
    else {
      assert.ok(html.includes(fixState === "none_found" ? copy.fixNone : presentation.PRESENTATION_COPY[fixState]));
      assert.doesNotMatch(html, /Synthetic issue|Drills that can help|hide-fix/);
    }
    if (shared) assert.doesNotMatch(html, /Delete at-bat|>Share<|Doesn't look right/);
  }
});

test("UI-PR6 experimental copy distinguishes hidden from unavailable moments and preserves outcomes", () => {
  const esc = value => String(value ?? "");
  for (const outcome of ["processing", "findings", "no_supported_issue", "insufficient_evidence", "withheld", "not_assessable", "analysis_not_enabled", "analysis_failed"]) {
    const exp = { outcome, findings: outcome === "findings" ? [{ kind: "issue", issue: "Synthetic finding", id: "issue" }] : [], events: [], reasons: [], suppressedCount: 0 };
    const p = experimentalPresentation({ report: exp });
    const html = experimentalReportHtml({ experimental: exp, presentation: p, status: "ready" }, { esc, canAct: false });
    assert.ok(html.includes(presentation.outcomeCopy(outcome).title));
    assert.doesNotMatch(html, /data-hide-issue|Delete|>Share</);
  }
  for (const [storedIssueFindings, phrase] of [[[{ review_status: "hidden" }], "An observation was hidden after feedback"], [[], "swing moment it cited isn't available"]]) {
    const exp = { outcome: "findings", findings: [], events: [], reasons: [], suppressedCount: 1 };
    const p = experimentalPresentation({ report: exp, storedIssueFindings });
    const html = experimentalReportHtml({ experimental: exp, presentation: p, status: "ready" }, { esc });
    assert.ok(html.includes(phrase)); assert.match(html, /class="simple-status-line" role="note"/);
    assert.ok(html.indexOf("simple-experimental") < html.indexOf("simple-status-line"));
    if (!storedIssueFindings.length) assert.doesNotMatch(html, /hidden after feedback/);
    const fallback = experimentalReportHtml({ experimental: exp, status: "ready" }, { esc });
    // Without presentation the client can't tell why no issue is visible, so it claims nothing.
    assert.match(fallback, /This swing's experimental result can't be shown\./);
    assert.doesNotMatch(fallback, /What the evidence supports|hidden after feedback/);
  }
});

test("UI-PR6 all demo reports carry valid presentation matching their existing sections", () => {
  const previous = globalThis.location;
  globalThis.location = { origin: "https://example.test" };
  try {
    for (const data of Object.values(demoShowcase("demo", "/demo/").reports)) {
      const p = presentation.parsePresentation(data.presentation);
      assert.ok(p); assert.equal(p.engine, "baseline");
      assert.equal(p.fixState, data.report.fix ? "shown" : "none_found");
      assert.equal(p.analysisState, data.report.fix ? "supported_finding" : "no_supported_issue");
      assert.equal(p.strengthsState, data.report.strengths.length ? "shown" : "none_found");
    }
  } finally { globalThis.location = previous; }
});

test("UI-PR7 not_confident uses the approved copy", () => {
  assert.equal(presentation.PRESENTATION_COPY.not_confident, "We noticed something, but couldn't see it clearly enough to recommend a change.");
});

test("UI-PR7 baseline reports ignore injected moments and phases in every fix state and viewer", async () => {
  const h = await appHarness();
  vm.runInContext('loadCaptureSummary = async () => {}; loadCoachAnalysisAction = async () => {};', h.sandbox);
  const moments = [{ event: "foot_plant", rawPtsS: 1, seekS: 1, identity: "verified" }];
  for (const viewer of ["coach", "parent", "shared", "demo"]) {
    vm.runInContext(`state.role = "${viewer === "coach" ? "coach" : "parent"}"; state.shared = ${viewer === "shared"}; state.demo = ${viewer === "demo"};`, h.sandbox);
    for (const analysisState of ["supported_finding", "no_supported_issue", "limited"]) {
      for (const fixState of ["shown", "none_found", "not_confident", "hidden_after_feedback", "withheld_evidence", "not_applicable"]) {
        const payload = readyPayload();
        payload.contactTime = 2;
        payload.moments = moments;
        payload.report.moments = moments;
        payload.report.strengths = [{ text: "Synthetic strength", phase: "load", moments }];
        Object.assign(payload.report.fix, { phase: "foot_plant", moments });
        Object.assign(payload.presentation, { analysisState, fixState, limited: analysisState === "limited" });
        h.node("reportVideo").currentTime = 3;
        h.sandbox.payload = payload;
        await vm.runInContext('showReport("clip", null, payload)', h.sandbox);
        const html = h.node("simpleRoot").innerHTML;
        assert.doesNotMatch(html, /Show me|See it|data-see-event/, `${viewer}/${analysisState}/${fixState}`);
        assert.doesNotMatch(html, /jump-contact|simple-contact-track|Watch the swing|Estimated hitting moment/);
        assert.match(html, /class="simple-action link" data-action="play-video"[^>]*>Play video/);
        assert.equal(h.node("reportVideo").currentTime, 3);
        assert.equal(h.node("reportVideo").listeners.loadedmetadata, undefined);
      }
    }
  }
});

// Use the real seekTo with a media mock that supports multiple listeners, like a video.
function momentVideo(h) {
  const video = h.node("reportVideo");
  const events = new Map();
  const calls = [];
  Object.assign(video, {
    readyState: 1, duration: 5, currentTime: 0, error: null,
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); },
    emit(type) { for (const fn of [...(events.get(type) ?? [])]) fn(); },
    pause() { calls.push("pause"); },
    scrollIntoView(options) { calls.push(["scroll", options.block]); },
    focus(options) { calls.push(["focus", options.preventScroll]); },
    load() { this.error = null; this.currentTime = 0; },
  });
  h.node("seekAnnouncement").textContent = ""; h.node("simpleMessage").textContent = "";
  h.sandbox.momentReport = { clipId: "clip", experimental: { events: [{ id: "load_peak_estimate", seekS: 1.125 }] } };
  vm.runInContext('state.tab = "report"; state.report = momentReport;', h.sandbox);
  return { video, calls };
}

test("UI-PR7 See it pauses at the exact seek target, then scrolls, focuses and announces", async () => {
  const h = await appHarness();
  const { video, calls } = momentVideo(h);
  const pending = clickAction(h, { seeEvent: "load_peak_estimate" });
  assert.equal(video.currentTime, 1.125);
  assert.deepEqual(calls, ["pause"]);
  assert.equal(h.node("seekAnnouncement").textContent, "");
  video.emit("seeked"); await pending; await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(calls, ["pause", ["scroll", "center"], ["focus", true]]);
  assert.equal(h.node("seekAnnouncement").textContent, "Video paused at load (estimated)"); assert.equal(h.node("simpleMessage").textContent, "");
  assert.deepEqual(h.snacks, []);
  const { experimentalReportHtml: render } = await import("./experimentalReport.js");
  assert.match(render({ status: "ready", experimental: { outcome: "processing", events: [], findings: [], reasons: [] } }, { esc: String }), /id="seekAnnouncement" class="simple-sr-only" role="status" aria-live="polite"/);
});

test("UI-PR7 invalid, absent and failed seeks never announce, focus or add error text", async () => {
  for (const failure of ["existing-error", "seek-error", "setter-error", "missing", NaN, Infinity, -1, null, undefined]) {
    const h = await appHarness();
    const { video, calls } = momentVideo(h);
    if (failure === "existing-error") video.error = { code: 3 };
    if (failure === "setter-error") Object.defineProperty(video, "currentTime", { get: () => 0, set: () => { throw new Error("seek failed"); } });
    if (typeof failure !== "string") h.sandbox.momentReport.experimental.events[0].seekS = failure;
    const pending = clickAction(h, { seeEvent: failure === "missing" ? "absent" : "load_peak_estimate" });
    if (failure === "seek-error") video.emit("error");
    await pending;
    assert.ok(calls.every(call => call === "pause"), String(failure));
    assert.equal(h.node("seekAnnouncement").textContent, "");
    assert.equal(h.node("simpleMessage").textContent, "");
    assert.deepEqual(h.snacks, []);
  }
});

test("UI-PR7 See it retains exact seeking and accessibility after the automatic URL refresh", async () => {
  const h = await appHarness();
  const { video, calls } = momentVideo(h);
  let fetches = 0;
  h.sandbox.reportApi = async () => { fetches++; return { videoUrl: "https://example.invalid/refreshed" }; };
  vm.runInContext('prepareReportVideo("clip", "share-token")', h.sandbox);
  video.error = { code: 2 };
  video.emit("error"); await new Promise(setImmediate);
  assert.equal(fetches, 1);
  assert.equal(video.src, "https://example.invalid/refreshed");
  assert.equal(h.node("reportVideo"), video);
  const pending = clickAction(h, { seeEvent: "load_peak_estimate" });
  assert.equal(video.currentTime, 1.125);
  video.emit("seeked"); await pending; await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(calls, ["pause", ["scroll", "center"], ["focus", true]]);
  assert.equal(h.node("seekAnnouncement").textContent, "Video paused at load (estimated)"); assert.equal(h.node("simpleMessage").textContent, "");
  assert.equal(fetches, 1);
});

test("UI-PR7 a second See it tap on the same moment is announced again", async () => {
  const h = await appHarness();
  const { video } = momentVideo(h);
  for (let tap = 0; tap < 2; tap += 1) {
    const pending = clickAction(h, { seeEvent: "load_peak_estimate" });
    video.currentTime = 0; video.emit("seeked"); await pending;
    assert.equal(h.node("seekAnnouncement").textContent, "", "cleared before re-announcing");
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(h.node("seekAnnouncement").textContent, "Video paused at load (estimated)");
  }
});
test("UI-PR7.1 Play video resumes, restarts ended videos, and swallows interrupted play", async () => {
  const h = await appHarness();
  const video = h.node("reportVideo");
  let plays = 0;
  Object.assign(video, { currentTime: 2.75, ended: false, play: async () => { plays++; } });
  await clickAction(h, { action: "play-video" });
  assert.equal(video.currentTime, 2.75);
  video.ended = true;
  await clickAction(h, { action: "play-video" });
  assert.equal(video.currentTime, 0);
  assert.equal(plays, 2);
  video.play = async () => { throw new Error("interrupted"); };
  await clickAction(h, { action: "play-video" });
  assert.deepEqual(h.snacks, []);
});

test("UI-PR7.1 jump-contact ignores baseline times and missing experimental targets", async () => {
  const h = await appHarness();
  const video = h.node("reportVideo");
  video.currentTime = 4;
  video.play = () => { assert.fail("must not play"); };
  for (const report of [{ contactTime: 2 }, { contactTime: 2, experimental: { events: [] } }]) {
    h.sandbox.payload = report;
    vm.runInContext('state.report = payload', h.sandbox);
    await clickAction(h, { action: "jump-contact" });
    assert.equal(video.currentTime, 4);
  }
  assert.deepEqual(h.snacks, []);
});

test("UI-PR7.1 Progress plays from zero, pauses and resumes without baseline alignment for every viewer", async () => {
  for (const viewer of ["coach", "parent", "shared", "demo"]) {
    const h = await appHarness();
    const videos = [h.node("thenVideo"), h.node("nowVideo")];
    const plays = [];
    for (const [index, video] of videos.entries()) Object.assign(video, {
      currentTime: 0, paused: true, ended: false, readyState: 1, duration: 10,
      removeEventListener() {},
      play: async () => { plays.push([index, video.currentTime]); video.paused = false; },
      pause: () => { video.paused = true; },
    });
    h.sandbox.payload = { playerName: "Synthetic", progress: { status: "early_read", current: null, history: [],
      thenVideo: { url: "then.mp4", contactTime: 3 }, nowVideo: { url: "now.mp4", contactTime: 7 } } };
    vm.runInContext(`state.role = "${viewer === "coach" ? "coach" : "parent"}"; state.shared = ${viewer === "shared"}; state.demo = ${viewer === "demo"}; state.home = payload`, h.sandbox);
    await vm.runInContext('showProgress()', h.sandbox);
    const html = h.node("simpleRoot").innerHTML;
    assert.match(html, /Watch the two videos side by side\. Camera views and timing can differ\./);
    assert.match(html, /Refresh videos/);
    assert.doesNotMatch(html, /estimated hitting moment/i);
    for (const video of videos) {
      assert.equal(video.currentTime, 0);
      assert.equal(video.listeners.timeupdate, undefined);
      assert.equal(video.listeners.loadedmetadata, undefined);
    }
    const button = { dataset: { action: "play-compare" } };
    const click = () => h.node("simpleRoot").listeners.click({ target: { closest: () => button } });
    await click();
    assert.deepEqual(plays, [[0, 0], [1, 0]]);
    assert.equal(button.textContent, "Pause both");
    videos[0].currentTime = 1; videos[1].currentTime = 1.2;
    await click();
    assert.ok(videos.every(video => video.paused));
    assert.equal(button.textContent, "Play together");
    await click();
    assert.deepEqual(plays.slice(2), [[0, 1], [1, 1.2]]);
    await click();
    videos[0].ended = true;
    for (const video of videos) {
      let at = video.currentTime;
      Object.defineProperty(video, "currentTime", { get: () => at, set: value => {
        at = value; queueMicrotask(() => video.listeners.seeked?.());
      } });
    }
    await click();
    assert.deepEqual(plays.slice(4), [[0, 0], [1, 0]]);
    assert.deepEqual(h.snacks, []);
  }
});
