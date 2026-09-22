// Supabase project connection info for the internal methodology-admin app.
// Trimmed version of coach/config.js's resolveConfig() - this app only ever
// runs in a regular browser on a coach/admin's own machine (no Capacitor/
// native-shell case to handle here, unlike coach/config.js).
//
// A URL + anon key are NOT secrets - Row-Level Security (see
// supabase/migrations/00029_methodology_knowledge.sql) is what actually
// protects data. Safe to commit, including real hosted values below once
// you have them.
const PROD_SUPABASE_URL = "";
const PROD_SUPABASE_ANON_KEY = "";

// `supabase start`'s own fixed local-dev demo anon key - identical on every
// machine running the Supabase CLI locally, not a real per-project secret.
const LOCAL_DEV_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

function resolveConfig() {
  if (PROD_SUPABASE_URL && PROD_SUPABASE_ANON_KEY) {
    return { url: PROD_SUPABASE_URL, key: PROD_SUPABASE_ANON_KEY };
  }
  return { url: `http://${window.location.hostname}:54321`, key: LOCAL_DEV_ANON_KEY };
}

const resolved = resolveConfig();
export const SUPABASE_URL = resolved.url;
export const SUPABASE_ANON_KEY = resolved.key;
