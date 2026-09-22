// Reference template for the eventual joncurry.co/hitterloop/demo publish
// step (Phase 5 - NOT built here; the personal-site repo is explicitly out
// of scope for this repo's session). This is the shape/values that repo's
// build-time injection of window.__HITTERLOOP_DEMO_CONFIG__ should produce
// once that publishing pipeline exists - kept here as an app-side
// reference only, since this repo owns the demo backend and knows its
// real values; it does not touch or assume anything about how the website
// repo actually injects it (a build script, a static <script> tag, a CMS
// field, etc. - that's that repo's own decision).
//
// supabaseUrl/supabaseAnonKey below are the REAL cloud HitterLoop
// project's URL and anon key (not secrets - see coach/config.js's own
// header for why an anon key is safe to publish; RLS is the actual
// boundary, verified for demo.* in
// docs/research/demo-shared-project-architecture.md). Never the
// service-role key - nothing in the browser build ever needs it, in demo
// mode or otherwise.
window.__HITTERLOOP_DEMO_CONFIG__ = {
  mode: "demo",
  basePath: "/hitterloop/demo/",
  supabaseUrl: "https://rjnpaqsqslvzkwwwqmze.supabase.co",
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqbnBhcXNxc2x2emt3d3dxbXplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4NDQxNjQsImV4cCI6MjEwNTQyMDE2NH0.yM4Pz3KADp0u5OnGBbmhNK-JjQPOV5wfSd2NR_0UWpk",
  // dataNamespace is deliberately NOT set here either - demoConfig.js
  // always forces it to "demo" regardless of what's passed.
  capabilities: { uploads: false, liveAnalysis: false },
  returnUrl: "https://joncurry.co/projects/hitterloop",
};
