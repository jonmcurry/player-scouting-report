// Supabase project connection info for the coach app. Unlike .env.example's
// SUPABASE_SERVICE_ROLE_KEY, a URL + anon key are NOT secrets - Row-Level
// Security, not key secrecy, is what actually protects data (see
// supabase/migrations/00001_initial_schema.sql's architecture note). Safe to
// commit, including real hosted values below once you have them.
//
// Resolution order (see resolveConfig()):
//   1. PROD_SUPABASE_URL/KEY below, if both are filled in - always wins,
//      browser or native shell alike. Fill these in from your hosted
//      Supabase project (Project Settings -> API) before shipping this app
//      to real coaches, and disable open signup on that project first
//      (Studio -> Auth -> Settings) - the local CLI default has self-service
//      signup ON, fine for local testing, not for a small trusted-coach app
//      with a publicly reachable login page.
//   2. Otherwise, in a regular browser (not the native shell): derive from
//      window.location.hostname - works automatically whether that's
//      http://localhost or a coach's phone hitting this dev machine's LAN IP
//      over WiFi (Kong already publishes to 0.0.0.0), zero config needed.
//   3. Otherwise (native shell): Capacitor's webview reports
//      window.location.hostname as "localhost", meaning the device/emulator
//      itself - there's no local Supabase stack running there, so this reads
//      window.__BARRELIQ_LOCAL_CONFIG__.lanHost instead, set by the
//      gitignored coach/config.local.js (copy coach/config.local.example.js
//      to create it - same .env/.env.example pattern already used
//      elsewhere in this repo). Throws a clear, actionable error if none of
//      the three are available, rather than silently pointing a coach's
//      real device at some other dev's home network.
const PROD_SUPABASE_URL = "";
const PROD_SUPABASE_ANON_KEY = "";

// `supabase start`'s own fixed local-dev demo anon key - identical on every
// machine running the Supabase CLI locally (iss: "supabase-demo"), not a
// real per-project secret.
const LOCAL_DEV_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const isNativeShell =
  typeof window !== "undefined" &&
  !!window.Capacitor &&
  typeof window.Capacitor.isNativePlatform === "function" &&
  window.Capacitor.isNativePlatform();

function resolveConfig() {
  if (PROD_SUPABASE_URL && PROD_SUPABASE_ANON_KEY) {
    return { url: PROD_SUPABASE_URL, key: PROD_SUPABASE_ANON_KEY };
  }
  if (!isNativeShell) {
    return { url: `http://${window.location.hostname}:54321`, key: LOCAL_DEV_ANON_KEY };
  }
  const lanHost = window.__BARRELIQ_LOCAL_CONFIG__ && window.__BARRELIQ_LOCAL_CONFIG__.lanHost;
  if (!lanHost) {
    throw new Error(
      "coach/config.js: no Supabase config available. Not running in a regular browser (so " +
        "window.location.hostname can't be used), PROD_SUPABASE_URL/PROD_SUPABASE_ANON_KEY are " +
        "blank, and no coach/config.local.js was found. Either copy " +
        "coach/config.local.example.js to coach/config.local.js and set your dev machine's LAN " +
        "IP, or fill in PROD_SUPABASE_URL/PROD_SUPABASE_ANON_KEY above for a real deploy.",
    );
  }
  return { url: `http://${lanHost}:54321`, key: LOCAL_DEV_ANON_KEY };
}

const resolved = resolveConfig();
export const SUPABASE_URL = resolved.url;
export const SUPABASE_ANON_KEY = resolved.key;
