// Centralized demo runtime configuration (Phase 3 of the approved
// HitterLoop demo architecture). This is the ONLY place "is this a demo"
// is ever decided - no pathname checks anywhere else in coach/. Every
// existing page and the Android/Capacitor build never set
// window.__HITTERLOOP_DEMO_CONFIG__, so getDemoConfig().mode is always
// "normal" there, and none of this module's logic engages.
//
// The one global it reads, window.__HITTERLOOP_DEMO_CONFIG__, is set by an
// optional, non-module <script> loaded BEFORE this module - see
// coach/demo.local.example.js (gitignored real file: coach/demo.local.js)
// for local testing, and (later, Phase 5) whatever the personal-site
// build-copy step injects when publishing under /hitterloop/demo/. Mirrors
// the existing window.__HITTERLOOP_LOCAL_CONFIG__ pattern coach/config.js
// already uses for the native-shell case - same inert-if-absent contract.
//
// Shape (per the approved architecture doc, amended for the temporary
// same-project + isolated `demo` Postgres schema architecture - see
// docs/research/demo-shared-project-architecture.md):
//   {
//     mode: "demo" | "normal",
//     basePath: string,
//     supabaseUrl: string,
//     supabaseAnonKey: string,
//     dataNamespace: string,  // Postgres schema demo queries/RPCs resolve
//                              // against - "demo", never "public". This is
//                              // the ONLY thing that changes between the
//                              // demo and normal Supabase clients; every
//                              // .from()/.rpc() call site elsewhere in
//                              // coach/ is completely unchanged.
//     capabilities: { uploads: boolean, liveAnalysis: boolean },
//     returnUrl: string,
//   }

const NORMAL_CONFIG = Object.freeze({
  mode: "normal",
  basePath: "./",
  supabaseUrl: null,
  supabaseAnonKey: null,
  dataNamespace: "public",
  capabilities: Object.freeze({ uploads: true, liveAnalysis: true }),
  returnUrl: null,
});

let cached = null;

export function getDemoConfig() {
  if (cached) return cached;
  const raw = typeof window !== "undefined" ? window.__HITTERLOOP_DEMO_CONFIG__ : null;
  if (!raw || raw.mode !== "demo") {
    cached = NORMAL_CONFIG;
    return cached;
  }
  if (!raw.supabaseUrl || !raw.supabaseAnonKey) {
    throw new Error(
      "window.__HITTERLOOP_DEMO_CONFIG__ has mode: \"demo\" but is missing supabaseUrl/supabaseAnonKey - " +
        "refusing to fall back to production or local-dev Supabase config for a demo session.",
    );
  }
  cached = Object.freeze({
    mode: "demo",
    basePath: raw.basePath || "/hitterloop/demo/",
    supabaseUrl: raw.supabaseUrl,
    supabaseAnonKey: raw.supabaseAnonKey,
    // Always "demo" - not reader-configurable. The whole point of this
    // field is that demo mode can never accidentally resolve against
    // "public" (real production data) no matter what a hand-edited
    // demo.local.js/site-publish config gets wrong; see
    // docs/research/demo-shared-project-architecture.md.
    dataNamespace: "demo",
    capabilities: Object.freeze({
      uploads: raw.capabilities?.uploads === true,
      liveAnalysis: raw.capabilities?.liveAnalysis === true,
    }),
    returnUrl: raw.returnUrl || "https://joncurry.co/projects/hitterloop",
  });
  return cached;
}

export function isDemoMode() {
  return getDemoConfig().mode === "demo";
}
