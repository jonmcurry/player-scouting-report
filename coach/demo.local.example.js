// Copy this file to coach/demo.local.js (gitignored - never commit real
// values there) to manually exercise demo mode locally, right now, without
// the Phase 5 site-publishing pipeline. Loaded as a plain (non-module)
// <script> before shared.js in every coach/*.html page - same pattern as
// coach/config.local.example.js - so it just needs to exist on disk.
// Absent (the normal case, and always the case in the Android/Capacitor
// build), this is a silent no-op: coach/demoConfig.js's getDemoConfig()
// defaults to mode: "normal" and nothing about the app changes.
//
// To test locally against the LOCAL Supabase stack, standing in for the
// real shared HitterLoop project's isolated `demo` schema (temporary
// same-project architecture - see
// docs/research/demo-shared-project-architecture.md):
//   1. Temporarily enable anonymous auth locally:
//        sed -i '' 's/enable_anonymous_sign_ins = false/enable_anonymous_sign_ins = true/' supabase/config.toml
//        npx supabase stop && npx supabase start
//   2. The demo schema/RPCs/seed (supabase/migrations/00031_demo_shared_project_schema.sql,
//      00032_demo_seed_v1.sql) are real migrations - `npx supabase start`/
//      `db reset` already applies them locally, same as every other
//      migration. Nothing extra to apply by hand.
//   3. Copy this file to coach/demo.local.js and fill in the local anon key
//      below (the fixed local-dev demo key `supabase start` always prints -
//      NOT a real secret). Same URL/anon key the normal app uses locally -
//      the demo/normal boundary here is the `demo` Postgres schema
//      (dataNamespace, forced by demoConfig.js), not a separate project.
//   4. Serve coach/ locally and open any page (e.g. team.html) - it should
//      bootstrap an anonymous demo session automatically, no login shown.
//   5. When done, revert config.toml and run `npx supabase stop && npx supabase start`.
window.__HITTERLOOP_DEMO_CONFIG__ = {
  mode: "demo", // set to anything else (or delete this whole file) to fall back to normal mode
  basePath: "./",
  supabaseUrl: "http://127.0.0.1:54321",
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  // dataNamespace is deliberately NOT set here - demoConfig.js always
  // forces it to "demo" regardless of what's passed, so it can never be
  // hand-edited to "public" by mistake.
  capabilities: { uploads: false, liveAnalysis: false },
  returnUrl: "https://joncurry.co/projects/hitterloop",
};
