// Shared Supabase client + small helpers used by every admin/*.html page.
// Loaded as `<script type="module">`, no bundler - same convention as
// coach/shared.js, but this is a SEPARATE internal app: not added to
// coach/sw.js, not part of the Capacitor webDir, never bundled into the
// Android client (see mobile/capacitor.config.json's webDir: "../coach").
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Redirects to login if there's no active session; otherwise returns it. */
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

/**
 * Call at the top of every admin page except index.html. Redirects to the
 * login/landing page if there's no session, and shows an "Access denied"
 * state (never silently redirects away) if the signed-in user is not a
 * methodology admin - being a coach or head coach never implies this.
 * Returns the session on success, or null (caller should stop rendering).
 */
export async function requireMethodologyAdmin() {
  const session = await requireSession();
  if (!session) return null;
  const { data, error } = await supabase.rpc("is_methodology_admin");
  if (error || data !== true) {
    document.body.innerHTML =
      '<div class="access-denied"><h1>Access denied</h1>' +
      "<p>This account is not on the methodology-admin allowlist. Ask an existing " +
      "methodology admin to run <code>npm run provision-methodology-admin -- --email you@example.com --grant</code>.</p>" +
      '<p><a href="./index.html">Back</a></p></div>';
    return null;
  }
  return session;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "./index.html";
}

export function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Escapes text for safe interpolation into an innerHTML template string.
 * Same necessity/usage as coach/shared.js's escapeHtml - admin-entered free
 * text (source names, notes, claim text) round-trips into innerHTML here
 * with no build-step templating to do it automatically. */
export function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
