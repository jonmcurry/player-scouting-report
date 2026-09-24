// Shared Supabase client + small helpers used by every coach/*.html page.
// Loaded as `<script type="module">`, no bundler.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { getDemoConfig, isDemoMode } from "./demoConfig.js";

// Schema selection is the ONLY difference between the demo and normal
// clients (temporary same-project + isolated `demo` Postgres schema
// architecture - see docs/research/demo-shared-project-architecture.md).
// In demo mode, every .from()/.rpc() call anywhere in coach/ - completely
// unchanged at every call site - transparently resolves against the
// `demo` schema (demo.teams, demo.players, demo.start_demo_session(), ...)
// instead of `public`. Normal mode is byte-for-byte what it always was:
// dataNamespace is "public", which is supabase-js's own default, so this
// is a no-op there.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: getDemoConfig().dataNamespace },
});

// ---------------------------------------------------------------------
// Demo mode (Phase 3 of the approved demo architecture). Everything here
// is a no-op unless isDemoMode() is true (see demoConfig.js - the only
// place that's ever decided). Banner injection is unconditional-if-demo
// at module load, since shared.js is imported by every coach/*.html page
// including report.html (the public report must show it too); anonymous
// bootstrap only happens inside requireSession() below, since report.html
// never calls requireSession() and a report viewer must not get their own
// team cloned just for viewing a shared link.
// ---------------------------------------------------------------------

function injectDemoBanner() {
  if (typeof document === "undefined" || document.getElementById("hitterloopDemoBanner")) return;
  const demo = getDemoConfig();
  const bar = document.createElement("div");
  bar.id = "hitterloopDemoBanner";
  bar.setAttribute(
    "style",
    "position:sticky;top:0;z-index:9999;display:flex;align-items:center;justify-content:center;gap:12px;" +
      "flex-wrap:wrap;padding:6px 12px;background:#B4503A;color:#fff;font:600 13px/1.4 Inter,system-ui,sans-serif;",
  );
  bar.innerHTML =
    '<span>Public demo — read-only; your changes reset</span>' +
    '<button type="button" id="hitterloopDemoReset" style="background:transparent;border:1px solid rgba(255,255,255,0.6);color:#fff;border-radius:6px;padding:2px 10px;font:inherit;cursor:pointer;">Reset demo</button>' +
    `<a href="${demo.returnUrl}" style="color:#fff;text-decoration:underline;">Return to HitterLoop</a>`;
  document.body.prepend(bar);
  document.getElementById("hitterloopDemoReset").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { data, error } = await supabase.rpc("reset_demo_session");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      window.location.href = `${demo.basePath}team.html?team=${encodeURIComponent(row.team_slug)}`;
    } catch {
      btn.disabled = false;
      alert("Could not reset the demo. Please try again.");
    }
  });
}

function injectDemoUploadHiding() {
  if (typeof document === "undefined" || getDemoConfig().capabilities.uploads) return;
  const style = document.createElement("style");
  // Best-effort UI hiding on top of the real functional gate in
  // videoUpload.js's uploadRawClip() (which is what actually prevents an
  // upload from ever happening). Covers the upload controls that carry a
  // stable, targetable selector today (player.html's .upload-control
  // wrapper and its "Choose Video" trigger); atbat.html's record-pitch
  // flow builds its file input purely in JS with no dedicated wrapper to
  // target here, so that path still relies on the functional gate alone -
  // called out explicitly rather than silently claimed as covered.
  style.textContent =
    'body.hitterloop-demo-no-uploads .upload-control,' +
    'body.hitterloop-demo-no-uploads #newVideoTrigger,' +
    'body.hitterloop-demo-no-uploads .add-clip-input,' +
    'body.hitterloop-demo-no-uploads .attach-video-input { display:none !important; }';
  document.head.appendChild(style);
  document.body.classList.add("hitterloop-demo-no-uploads");
}

if (isDemoMode()) {
  injectDemoBanner();
  injectDemoUploadHiding();
}

/**
 * Demo-mode anonymous bootstrap: signs in anonymously if there's no
 * session yet, then calls start_demo_session() so the visitor has their
 * own cloned team before any page tries to query team-scoped data. Only
 * ever called from requireSession() below - report.html's public,
 * unauthenticated path never triggers this.
 */
async function bootstrapDemoSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error(`Demo anonymous sign-in failed: ${error.message}`);
  }
  const { error: startErr } = await supabase.rpc("start_demo_session");
  if (startErr) throw new Error(`Demo session bootstrap failed: ${startErr.message}`);
  const { data: { session: fresh } } = await supabase.auth.getSession();
  return fresh;
}

/** The 11 fixed checkpoints, canonical order. Duplicated from
 * src/types/scouting.ts's CHECKPOINTS by necessity, not oversight - this is
 * plain browser JS with no build step, so it can't import from the Node CLI's
 * TypeScript source. If the checkpoint list ever changes, both this array
 * AND supabase/migrations/00001_initial_schema.sql's seed rows AND
 * src/types/scouting.ts need updating together - there's no single source
 * of truth across the JS/TS boundary here. */
export const CHECKPOINTS = [
  { slug: "stance-setup", label: "Stance & setup" },
  { slug: "load", label: "Load" },
  { slug: "stride", label: "Stride / front-foot plant" },
  { slug: "hip-shoulder-sep", label: "Hip-shoulder separation" },
  { slug: "hand-path", label: "Hand path to ball" },
  { slug: "bat-path", label: "Bat path through zone" },
  { slug: "contact-point", label: "Contact point" },
  { slug: "extension", label: "Extension" },
  { slug: "head-eyes", label: "Head/eyes" },
  { slug: "follow-through", label: "Follow-through & finish" },
  { slug: "swing-decisions", label: "Swing decisions (pitch selection)" },
];

/** Redirects to login if there's no active session; otherwise returns it.
 * Call at the top of every page except index.html.
 *
 * In demo mode, there is no login page to redirect to at all: a missing
 * session instead triggers anonymous bootstrap (bootstrapDemoSession()
 * above), so a demo visitor lands directly on real product pages without
 * ever seeing the normal coach sign-in form - matching the architecture's
 * "creates an anonymous demo session without showing normal login"
 * requirement. Normal (non-demo) mode is completely unchanged. */
export async function requireSession() {
  if (isDemoMode()) {
    try {
      return await bootstrapDemoSession();
    } catch (err) {
      console.error(err);
      document.body.innerHTML = '<p style="padding:24px;">Could not start the demo. Please reload the page.</p>';
      return null;
    }
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "./index.html";
    return null;
  }
  return session;
}

export async function getMyDisplayName(userId) {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("display_name")
    .eq("user_id", userId)
    .single();
  if (error || !data) return "Coach";
  return data.display_name;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "./index.html";
}

export function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Escapes text for safe interpolation into an innerHTML template string.
 * Real, necessary defense: coach-entered free text (player/team names,
 * opponent, notes, at-bat results) round-trips straight into innerHTML
 * across this app with no build-step templating to do it automatically -
 * without this, a coach typing `<img src=x onerror=...>` into any of those
 * fields runs as script for every other coach who views that data, and (via
 * report.html's public, unauthenticated share-link page) for anyone who
 * opens the link at all. Use for every DB-sourced string embedded via
 * innerHTML/template literals; not needed for values only ever set via
 * textContent or a DOM property (those never parse as markup). */
export function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// PWA offline shell (ux.md Step 5.3) - registered once here since shared.js
// is imported by every coach/*.html page, rather than duplicating a
// <script> registration block per page.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
  // Without this, a new sw.js (new CACHE_NAME) only takes over AFTER every
  // open tab is closed and reopened - skipWaiting()/clients.claim() in sw.js
  // make the new worker take control of already-open tabs immediately, but
  // those tabs are still rendering whatever the OLD worker served them; this
  // reloads once, automatically, the moment control actually changes hands,
  // so a coach never has to manually close/reopen the app to get a fix.
  //
  // Only when a previous worker is being REPLACED: on a first-ever visit,
  // clients.claim() also fires controllerchange (no controller -> first
  // controller) and reloading then aborted whatever the page was doing -
  // concretely, the demo's in-flight start_demo_session() bootstrap (seen as
  // HTTP 499s at the gateway, 2026-09-23). A first install serves the same
  // files that just loaded, so there is nothing stale to reload away from.
  const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller);
  let reloadedForNewWorker = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadControllerAtLoad || reloadedForNewWorker) return;
    reloadedForNewWorker = true;
    window.location.reload();
  });
}

/** Same three states as the old static report template's .review-badge
 * (ai-draft / edited-unconfirmed / confirmed, since removed), rendered with
 * this app's punchier badge classes. */
export function renderReviewBadge(row) {
  if (row.score === null || row.score === undefined) return "";
  if (!row.reviewed_by) {
    if (row.ai_draft != null && row.ai_draft !== row.score) {
      return `<span class="badge edited">AI: ${row.ai_draft} → unconfirmed</span>`;
    }
    return `<span class="badge ai-draft">\u{1F916} AI Draft (${row.ai_draft}) — Tap to Confirm</span>`;
  }
  const diff =
    row.ai_draft != null && row.ai_draft !== row.score
      ? ` (AI: ${row.ai_draft} → Coach: ${row.score})`
      : "";
  return `<span class="badge confirmed">✓ Verified by ${escapeHtml(row.reviewed_by)}${diff}</span>`;
}
