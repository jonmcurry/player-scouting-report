// Shared Supabase client + small helpers used by every coach/*.html page.
// Loaded as `<script type="module">`, no bundler.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
 * Call at the top of every page except index.html. */
export async function requireSession() {
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
  let reloadedForNewWorker = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedForNewWorker) return;
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
