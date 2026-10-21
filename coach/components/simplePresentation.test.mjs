import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createNavigation, initNavigation } from "./simpleNavigation.js";
import * as guardianAdmin from "./guardianAdmin.js";
import { icon } from "./ui.js";
import { experimentalReportHtml, experimentalStillPending } from "./experimentalReport.js";
import * as presentation from "./simplePresentation.js";
import { plainFailureReason } from "../../dist/services/development/reportAssembly.js";
const { REPORT_COPY: copy, fixNoneCopy, strengthsNoneCopy, momentLabels, unavailablePresentation,
  userErrorMessage, describeFunctionsError, reportFetchFailure } = presentation;
const httpError = (status) => Object.assign(new Error("Edge Function returned a non-2xx status code"), {
  name: "FunctionsHttpError", context: new Response(JSON.stringify({ error: "private server detail" }), { status }),
});
const captureCases = [["batter", "batter missing"], ["swing", "no swing"], ["short", "too short"], ["blurry", "blur"]];

test("frozen copy and empty sections use the approved wording", () => {
  assert.ok(Object.isFrozen(copy));
  assert.ok(Object.isFrozen(momentLabels));
  assert.equal(fixNoneCopy(), "We didn't see one clear thing to work on in this swing. One video can't show everything; patterns show up over 3+ game at-bats.");
  assert.equal(strengthsNoneCopy(), "Nothing stood out clearly enough to call out in this swing.");
  assert.deepEqual(momentLabels, { button: "Watch the swing", marker: "Estimated hitting moment" });
});

test("capture failures match server copy and offer filming guidance without findings", () => {
  for (const [key, internal] of captureCases) {
    assert.equal(copy[key], plainFailureReason(internal));
    assert.deepEqual(unavailablePresentation({ status: "failed", report: { reason: copy[key], summary: "must not escape" } }), {
      kind: "unavailable_evidence", title: "We couldn't analyze this swing", reason: copy[key], showFilmingTip: true,
    });
  }
});

test("duration and unknown technical failures do not blame capture", () => {
  assert.equal(copy.duration, plainFailureReason("3-minute upload limit"));
  assert.deepEqual(unavailablePresentation({ status: "failed", report: { reason: copy.duration } }), {
    kind: "failed_technical", title: "We couldn't analyze this video", reason: copy.duration, showFilmingTip: false,
  });
  for (const reason of [undefined, "private runtime detail", copy.unavailableReason]) {
    assert.deepEqual(unavailablePresentation({ status: "failed", report: { reason } }), {
      kind: "failed_technical", title: "Something went wrong on our side.",
      reason: "We couldn't finish analyzing this video.", showFilmingTip: false,
    });
  }
});

test("ready but unreadable reports retain the plain reason and fallback", () => {
  for (const reason of [copy.batter, undefined, ""]) {
    assert.deepEqual(unavailablePresentation({ status: "ready", report: { state: "unreadable", reason } }), {
      kind: "unavailable_evidence", title: "We couldn't analyze this swing",
      reason: reason || "We couldn't analyze this video.", showFilmingTip: true,
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
  const output = [copy, momentLabels, fixNoneCopy(), strengthsNoneCopy(), ...captureCases.map(([key]) =>
    unavailablePresentation({ status: "failed", report: { reason: copy[key] } })),
    unavailablePresentation({ status: "failed", report: {} }), userErrorMessage(httpError(500)), reportFetchFailure()];
  assert.doesNotMatch(JSON.stringify(output), /contact|Edge Function|confidence|%/i);
});

// Execute the actual UI wiring with synthetic transport/DOM objects; no browser, footage or account.
async function appHarness({ shared = true, online = true, error = httpError(404), data = null } = {}) {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: "", insertAdjacentHTML(_position, html) { this.innerHTML += html; }, hidden: false, listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; }, removeAttribute() {}, setAttribute() {}, after(element) { this.afterNode = element; }, load() {}, showModal() { this.open = true; }, close() { this.open = false; }, appendChild() {} });
    return nodes.get(id);
  };
  const warnings = []; const listeners = []; const snacks = []; const rpcs = []; const confirms = []; let reloads = 0;
  const source = (await readFile(new URL("./simpleApp.js", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "").replace(/start\(\);\s*$/, "");
  const sandbox = { ...presentation, ...guardianAdmin, icon, experimentalReportHtml, experimentalStillPending, createNavigation, initNavigation, PUBLIC_APP_ORIGIN: "",
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
    await vm.runInContext('showReport("synthetic", null, payload)', h.sandbox);
    const html = h.node("simpleRoot").innerHTML;
    assert.match(html, /<h1>/);
    assert.match(html, /<video/);
    assert.match(html, /Delete at-bat/);
    assert.equal(html.includes("How to film next time"), tip);
    assert.doesNotMatch(html, /How it went|What looked good|One thing to fix|Drills|retry/);
  }
});

test("Watch the swing seeks half a second early, clamps at zero, and plays", async () => {
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
    vm.runInContext(`state.report = { contactTime: ${time} };`, h.sandbox);
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
  h.sandbox.payload = { playerName: "Synthetic Player", status: "ready", report: { state: "no_swing" } };
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
const readyPayload = (fix = true) => ({ playerName: "Synthetic Player", status: "ready", videoUrl: "https://example.invalid/video", report: {
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
function database(h, responses = {}) {
  const calls = [];
  h.sandbox.supabase.from = (table) => {
    const call = { table, methods: [] }; calls.push(call);
    const query = { then(resolve, reject) { return Promise.resolve(typeof responses[table] === "function" ? responses[table](call) : responses[table] ?? { data: [], error: null }).then(resolve, reject); } };
    for (const method of ["select", "eq", "in", "order", "is", "gt", "insert", "update", "maybeSingle"]) query[method] = (...args) => { call.methods.push([method, ...args]); return query; };
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
  assert.ok(calls.some((c) => c.methods.some(([m, columns]) => m === "select" && columns === "id, name, jersey_number, slug")));
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
    h.sandbox.payload = { clipId: "clip", playerName: "Maya Sample", status: "ready", report: { state: "no_swing" } };
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
